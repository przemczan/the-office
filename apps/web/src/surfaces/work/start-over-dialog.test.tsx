import type { TaskWaysBack } from "@the-office/contracts";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/api-client.ts";
import type { startTaskOver } from "../../api/work.ts";
import { until } from "../../shell/page.fixtures.tsx";
import { StartOverDialog } from "./start-over-dialog.tsx";
import {
  aWaysBack,
  button,
  choice,
  rendered,
  TASK,
  unmounted,
} from "./way-back-dialogs.fixtures.tsx";

const api = vi.hoisted(() => ({ startTaskOver: vi.fn<typeof startTaskOver>() }));
vi.mock("../../api/work.ts", async (original) => ({
  ...(await original<typeof import("../../api/work.ts")>()),
  startTaskOver: api.startTaskOver,
}));

const onClose = vi.fn<() => void>();

function open(waysBack: Partial<TaskWaysBack> = {}): void {
  rendered(
    <StartOverDialog
      task={TASK}
      waysBack={aWaysBack({ resetTo: "office/initiative-login", ...waysBack })}
      onClose={onClose}
    />,
  );
}

const RESET = "Reset the branch to office/initiative-login";

describe("Start over", () => {
  afterEach(() => {
    unmounted();
    vi.clearAllMocks();
  });

  it("asks to reset the branch of a started Task, checked at first", () => {
    open();

    expect(document.body.textContent).toContain(`Start ${TASK.title} over?`);
    expect(choice(RESET).checked).toBe(true);
    expect(document.body.textContent).toContain("Its earlier Stage runs stay in the Stage history");
  });

  it("starts over to Ready at first, saying its parts stay confirmed", () => {
    open();

    expect(choice("To Ready").checked).toBe(true);
    expect(document.body.textContent).toContain(
      "Its Plan, Definition of Done and Pipeline stay confirmed, to start again from its first Stage.",
    );
  });

  it("starts over with the branch reset, and says the Task is Ready", async () => {
    api.startTaskOver.mockResolvedValue({ ...TASK, state: "ready" });
    open();

    await act(async () => button("Start over").click());

    await until(() =>
      expect(api.startTaskOver).toHaveBeenCalledWith(TASK.id, { to: "ready", resetBranch: true }),
    );
    await until(() =>
      expect(document.body.textContent).toContain("Started over: the Task is Ready."),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the branch when the reset is unchecked", async () => {
    api.startTaskOver.mockResolvedValue({ ...TASK, state: "ready" });
    open();
    act(() => choice(RESET).click());

    await act(async () => button("Start over").click());

    await until(() =>
      expect(api.startTaskOver).toHaveBeenCalledWith(TASK.id, { to: "ready", resetBranch: false }),
    );
  });

  it("starts over to Backlog when picked, to plan again", async () => {
    api.startTaskOver.mockResolvedValue({ ...TASK, state: "backlog" });
    open();
    act(() => choice("To Backlog").click());

    expect(document.body.textContent).toContain(
      "Its Plan, Definition of Done and Pipeline stay but go back to Not confirmed, to plan again, and its Stages edited for this Task are dropped.",
    );
    await act(async () => button("Start over").click());

    await until(() =>
      expect(api.startTaskOver).toHaveBeenCalledWith(TASK.id, { to: "backlog", resetBranch: true }),
    );
    await until(() =>
      expect(document.body.textContent).toContain(
        "Started over: the Task is in Backlog, to plan again.",
      ),
    );
  });

  it("keeps the branch once its work has left the workstation, saying why", async () => {
    api.startTaskOver.mockResolvedValue({ ...TASK, state: "ready" });
    open({ resetBranch: { offered: false, why: "Its work has left the workstation." } });

    expect(choice(RESET).checked).toBe(false);
    expect(choice(RESET).disabled).toBe(true);
    expect(document.body.textContent).toContain("Not reset: Its work has left the workstation.");
    await act(async () => button("Start over").click());

    await until(() =>
      expect(api.startTaskOver).toHaveBeenCalledWith(TASK.id, { to: "ready", resetBranch: false }),
    );
  });

  it("asks nothing of the branch of a Task that never started", async () => {
    api.startTaskOver.mockResolvedValue({ ...TASK, state: "ready" });
    open({ started: false, resetBranch: { offered: false, why: null } });

    expect(document.body.textContent).not.toContain("Reset the branch");
    await act(async () => button("Start over").click());
    await until(() =>
      expect(api.startTaskOver).toHaveBeenCalledWith(TASK.id, { to: "ready", resetBranch: false }),
    );
  });

  it("shows a refusal's reasons", async () => {
    api.startTaskOver.mockRejectedValue(new ApiError(422, "Refused", ["It is running again."]));
    open();

    await act(async () => button("Start over").click());

    await until(() =>
      expect(document.body.textContent).toContain("The Task can't be started over"),
    );
    expect(document.body.textContent).toContain("It is running again.");
    expect(onClose).not.toHaveBeenCalled();
  });
});
