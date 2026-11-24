import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/api-client.ts";
import type { reopenTask } from "../../api/work.ts";
import { until } from "../page.fixtures.tsx";
import { ReopenTaskDialog } from "./reopen-task-dialog.tsx";
import {
  aWaysBack,
  button,
  choice,
  rendered,
  TASK,
  unmounted,
} from "./way-back-dialogs.fixtures.tsx";

const api = vi.hoisted(() => ({ reopenTask: vi.fn<typeof reopenTask>() }));
vi.mock("../../api/work.ts", async (original) => ({
  ...(await original<typeof import("../../api/work.ts")>()),
  reopenTask: api.reopenTask,
}));

const DROPPED = { ...TASK, state: "dropped" as const };
const onClose = vi.fn<() => void>();

function open(waysBack = aWaysBack()): void {
  rendered(<ReopenTaskDialog task={DROPPED} waysBack={waysBack} onClose={onClose} />);
}

describe("Reopen…", () => {
  afterEach(() => {
    unmounted();
    vi.clearAllMocks();
  });

  it("reopens to Backlog at first, resetting a started Task's branch", async () => {
    api.reopenTask.mockResolvedValue({ ...TASK, state: "backlog" });
    open();

    expect(document.body.textContent).toContain(`Reopen ${TASK.title}?`);
    expect(choice("To Backlog").checked).toBe(true);
    expect(choice("Reset the branch to main").checked).toBe(true);
    await act(async () => button("Reopen the Task").click());

    await until(() =>
      expect(api.reopenTask).toHaveBeenCalledWith(TASK.id, { to: "backlog", resetBranch: true }),
    );
    await until(() => expect(document.body.textContent).toContain("Reopened to Backlog."));
    expect(onClose).toHaveBeenCalled();
  });

  it("reopens to Ready, keeping the branch when asked", async () => {
    api.reopenTask.mockResolvedValue({ ...TASK, state: "ready" });
    open();
    act(() => choice("To Ready").click());
    act(() => choice("Reset the branch to main").click());

    await act(async () => button("Reopen the Task").click());

    await until(() =>
      expect(api.reopenTask).toHaveBeenCalledWith(TASK.id, { to: "ready", resetBranch: false }),
    );
    await until(() => expect(document.body.textContent).toContain("Reopened to Ready."));
  });

  it("offers no To Ready while it can't go there, saying why", () => {
    open(
      aWaysBack({
        reopenToReady: { offered: false, why: "Its Pipeline was removed from the library." },
      }),
    );

    expect(choice("To Ready").disabled).toBe(true);
    expect(choice("To Ready").closest("label")?.title).toBe(
      "Its Pipeline was removed from the library.",
    );
    expect(document.body.textContent).toContain(
      "To Ready: Its Pipeline was removed from the library.",
    );
  });

  it("asks nothing of the branch of a Task that never started", async () => {
    api.reopenTask.mockResolvedValue({ ...TASK, state: "backlog" });
    open(aWaysBack({ started: false }));

    expect(document.body.textContent).not.toContain("Reset the branch");
    await act(async () => button("Reopen the Task").click());
    await until(() =>
      expect(api.reopenTask).toHaveBeenCalledWith(TASK.id, { to: "backlog", resetBranch: false }),
    );
  });

  it("shows a refusal's reasons", async () => {
    api.reopenTask.mockRejectedValue(new ApiError(422, "Refused", ["It was archived."]));
    open();

    await act(async () => button("Reopen the Task").click());

    await until(() => expect(document.body.textContent).toContain("The Task can't be reopened"));
    expect(document.body.textContent).toContain("It was archived.");
    expect(onClose).not.toHaveBeenCalled();
  });
});
