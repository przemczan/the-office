import type { OffBoardTask, ProjectOffBoardTasks } from "@the-office/contracts";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buttonWith,
  linkWith,
  offBoardTask,
  pressed,
  PROJECT,
  rendered,
  serving,
} from "./off-board-task.fixtures.tsx";
import { OnboardingBlock } from "./onboarding-block.tsx";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children: ReactNode;
    to: string;
    params: { taskId: string };
  }) => <a href={to.replace("$taskId", params.taskId)}>{children}</a>,
  useNavigate: () => vi.fn<() => void>(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const NONE: ProjectOffBoardTasks = { onboard: null, onboardHistory: [], runEnvironmentSetUp: null };

/** Answers the Off-board Tasks with `offBoard`, and Onboard with `onboarded`. */
function servingOnboard(offBoard: ProjectOffBoardTasks, onboarded?: unknown) {
  return serving((url, request) => {
    if (url.endsWith("/onboard") && request?.method === "POST") return onboarded;
    if (url.endsWith("/off-board-tasks")) return offBoard;
    return [];
  });
}

describe("the Project page's Onboarding card", () => {
  it("offers Onboard while the Project never had an Onboard Task, and starts it at the press", async () => {
    const started = offBoardTask({ state: "running" });
    const fetched = servingOnboard(NONE, { outcome: "started", offBoardTask: started });
    const { page, queryClient } = await rendered(<OnboardingBlock project={PROJECT} />);

    expect(page.textContent).toContain("Not onboarded yet.");
    expect(page.textContent).toContain(
      "Starts at once as an Off-board Task: no Start, not on the board.",
    );
    const onboard = buttonWith(page, "Onboard");
    expect(onboard?.textContent).not.toContain("Onboard again");
    if (onboard) await pressed(onboard, queryClient);

    const post = fetched.mock.calls.find(([, request]) => request?.method === "POST");
    expect(post?.[0]).toBe("/api/projects/admin-panel/onboard");
    expect(document.body.textContent).toContain("Dwight is onboarding Admin panel.");
  });

  it("says where a queued start waits", async () => {
    const queued = offBoardTask({
      state: "queued",
      place: 2,
      shortReasons: ["Project limit reached (1)"],
      queuedAt: new Date().toISOString(),
    });
    servingOnboard(NONE, { outcome: "started", offBoardTask: queued });
    const { page, queryClient } = await rendered(<OnboardingBlock project={PROJECT} />);
    const onboard = buttonWith(page, "Onboard");
    if (onboard) await pressed(onboard, queryClient);
    expect(document.body.textContent).toContain(
      "Onboard is queued, place 2: Project limit reached (1).",
    );
  });

  it("shows a refused start under the button, which stays", async () => {
    servingOnboard(NONE, { outcome: "refused", reasons: ["The fire alarm is on."] });
    const { page, queryClient } = await rendered(<OnboardingBlock project={PROJECT} />);
    const onboard = buttonWith(page, "Onboard");
    if (onboard) await pressed(onboard, queryClient);
    expect(page.textContent).toContain("Onboard didn't start");
    expect(page.textContent).toContain("The fire alarm is on.");
    expect(buttonWith(page, "Onboard")).toBeDefined();
  });

  it("shows the Onboard Task in flight in place of the button", async () => {
    servingOnboard({ ...NONE, onboard: offBoardTask({ state: "running" }) });
    const { page } = await rendered(<OnboardingBlock project={PROJECT} />);
    expect(page.textContent).toContain("Running");
    expect(buttonWith(page, "Onboard")).toBeUndefined();
  });

  it("offers Onboard again once the latest is Done, with the earlier ones under history", async () => {
    const earlier: OffBoardTask = offBoardTask(
      { state: "dropped", endedAt: "2026-09-28T10:00:00.000Z", dropReason: null },
      { taskId: "9e0c1f2a-3b4c-4d6e-8a1b-2c3d4e5f6a7b" },
    );
    servingOnboard({
      ...NONE,
      onboard: offBoardTask({ state: "done", endedAt: "2026-11-18T14:02:00.000Z" }),
      onboardHistory: [earlier],
    });
    const { page } = await rendered(<OnboardingBlock project={PROJECT} />);
    expect(buttonWith(page, "Onboard again")).toBeDefined();
    expect(page.textContent).toContain(
      "Onboard again starts a new Onboard Task on the base branch as it is now",
    );
    expect(page.textContent).toContain("Onboarding history:");
    expect(linkWith(page, "Onboard · Dropped 28 Sep")?.getAttribute("href")).toBe(
      `/tasks/${earlier.taskId}`,
    );
  });
});
