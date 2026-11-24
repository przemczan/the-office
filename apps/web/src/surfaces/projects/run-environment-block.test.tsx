import type { ProjectOffBoardTasks, ProjectRunEnvironment } from "@the-office/contracts";
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
  TASK_ID,
} from "./off-board-task.fixtures.tsx";
import { RunEnvironmentBlock } from "./run-environment-block.tsx";

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

const OFF: ProjectRunEnvironment = {
  runEnvironment: "off",
  definition: { state: "not-found" },
  setUpProblems: [],
  setUpTask: null,
};

const NONE: ProjectOffBoardTasks = { onboard: null, onboardHistory: [], runEnvironmentSetUp: null };

const SET_UP = { title: "Set up the run environment", kind: "run-environment-setup" } as const;

function servingRunEnvironment(
  runEnvironment: ProjectRunEnvironment,
  offBoard: ProjectOffBoardTasks,
  setUpAnswer?: unknown,
) {
  return serving((url, request) => {
    if (url.endsWith("/run-environment/set-up") && request?.method === "POST") return setUpAnswer;
    if (url.endsWith("/run-environment")) return runEnvironment;
    if (url.endsWith("/off-board-tasks")) return offBoard;
    return [];
  });
}

describe("the Project page's Run environment block", () => {
  it("starts the set-up Off-board Task at the press, and says who sets it up", async () => {
    const started = offBoardTask({ state: "running" }, SET_UP);
    const fetched = servingRunEnvironment(OFF, NONE, {
      runEnvironment: OFF,
      start: { outcome: "started", offBoardTask: started },
    });
    const { page, queryClient } = await rendered(<RunEnvironmentBlock project={PROJECT} />);
    expect(page.textContent).toContain(
      "otherwise Devops writes one in an Off-board Task that starts now.",
    );
    const setUp = buttonWith(page, "Set up run environment");
    if (setUp) await pressed(setUp, queryClient);
    const post = fetched.mock.calls.find(([, request]) => request?.method === "POST");
    expect(post?.[0]).toBe("/api/projects/admin-panel/run-environment/set-up");
    expect(document.body.textContent).toContain(
      "Dwight is setting up Admin panel's run environment.",
    );
  });

  it("shows a refused set-up under the button", async () => {
    servingRunEnvironment(OFF, NONE, {
      runEnvironment: OFF,
      start: { outcome: "refused", reasons: ["Nobody holds Onboards and repairs Projects."] },
    });
    const { page, queryClient } = await rendered(<RunEnvironmentBlock project={PROJECT} />);
    const setUp = buttonWith(page, "Set up run environment");
    if (setUp) await pressed(setUp, queryClient);
    expect(page.textContent).toContain("Nothing was set up");
    expect(page.textContent).toContain("Nobody holds Onboards and repairs Projects.");
  });

  it("shows the Off-board Task in flight in place of the button", async () => {
    servingRunEnvironment(OFF, {
      ...NONE,
      runEnvironmentSetUp: offBoardTask(
        {
          state: "queued",
          place: 1,
          shortReasons: ["All desks busy (3 of 3)"],
          queuedAt: new Date().toISOString(),
        },
        SET_UP,
      ),
    });
    const { page } = await rendered(<RunEnvironmentBlock project={PROJECT} />);
    expect(page.textContent).toContain("Place 1 in the queue");
    expect(page.textContent).toContain("Run environment turns On when it is Done.");
    expect(buttonWith(page, "Set up run environment")).toBeUndefined();
  });

  it("says it is On and which Off-board Task set it up once that is Done", async () => {
    servingRunEnvironment(
      { ...OFF, runEnvironment: "on", definition: { state: "valid" } },
      {
        ...NONE,
        runEnvironmentSetUp: offBoardTask(
          { state: "done", endedAt: "2026-11-21T10:00:00.000Z" },
          { ...SET_UP, tokens: 340_000 },
        ),
      },
    );
    const { page } = await rendered(
      <RunEnvironmentBlock project={{ ...PROJECT, runEnvironment: "on" }} />,
    );
    expect(page.textContent).toContain(
      "Run environment is On: Admin panel's .devcontainer/ is valid.",
    );
    expect(linkWith(page, "Set up the run environment")?.getAttribute("href")).toBe(
      `/tasks/${TASK_ID}`,
    );
    expect(page.textContent).toContain("340k tokens");
    expect(buttonWith(page, "Set up run environment")).toBeUndefined();
  });

  it("turns On at once with no .devcontainer/ on the base branch, saying where checks run", async () => {
    const fetched = serving((url, request) => {
      if (url.endsWith("/run-environment") && request?.method === "PUT") {
        return { ...OFF, runEnvironment: "on" };
      }
      if (url.endsWith("/run-environment")) return OFF;
      if (url.endsWith("/off-board-tasks")) return NONE;
      return [];
    });
    const { page, queryClient } = await rendered(<RunEnvironmentBlock project={PROJECT} />);
    expect(page.textContent).toContain(
      "each Task's checks run in the containers the .devcontainer/ on the Task's own branch defines",
    );
    expect(page.textContent).not.toContain("Not decided yet");
    const on = [...page.querySelectorAll("button")].find((each) => each.textContent === "On");
    if (on) await pressed(on, queryClient);
    const put = fetched.mock.calls.find(([, request]) => request?.method === "PUT");
    expect(put?.[1]?.body).toBe(JSON.stringify({ runEnvironment: "on" }));
    expect(document.body.textContent).toContain(
      "Checks in Admin panel run in its run environment.",
    );
    expect(page.querySelector('[role="alert"]')).toBeNull();
  });

  it("says why a Done set-up left the setting as it was", async () => {
    servingRunEnvironment({ ...OFF, setUpProblems: ["devcontainer.json: no compose file."] }, NONE);
    const { page } = await rendered(<RunEnvironmentBlock project={PROJECT} />);
    expect(page.textContent).toContain(
      "The last Off-board Task was Done, but the .devcontainer/ on its branch isn't valid",
    );
  });
});
