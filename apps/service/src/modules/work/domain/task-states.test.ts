import { describe, expect, it } from "vitest";
import { THE_USER } from "./author.js";
import { TASK_STATES, type TaskState } from "./task.js";
import { changeTaskState, markTaskReady } from "./task-changes.js";
import { TaskStateChanged } from "./task-events.js";
import { TaskRefused } from "./task-refused.js";
import { aPlannedTask, aTask } from "./work.fixtures.js";

/** Spec §2.1, written out here apart from the rules so that a change to either shows. */
const ALLOWED: readonly string[] = [
  "shaping → dropped",
  "backlog → planning",
  "backlog → ready",
  "backlog → dropped",
  "planning → ready",
  "planning → dropped",
  "ready → in-progress",
  "ready → dropped",
  "in-progress → waiting-on-you",
  "in-progress → paused",
  "in-progress → done",
  "in-progress → dropped",
  "waiting-on-you → in-progress",
  "waiting-on-you → paused",
  "waiting-on-you → dropped",
  "paused → in-progress",
  "paused → waiting-on-you",
  "paused → dropped",
];

const moves = TASK_STATES.flatMap((from) =>
  TASK_STATES.filter((to) => to !== from).map((to) => ({ from, to })),
);

function aTaskIn(state: TaskState) {
  return aPlannedTask({ state });
}

describe("changeTaskState", () => {
  it.each(moves.filter(({ from, to }) => ALLOWED.includes(`${from} → ${to}`)))(
    "moves a Task from $from to $to",
    ({ from, to }) => {
      const change = changeTaskState(aTaskIn(from), to, THE_USER);

      expect(change?.task.state).toBe(to);
      expect(change?.event).toBeInstanceOf(TaskStateChanged);
      expect(change?.event).toMatchObject({ taskId: "task-1", from, to });
    },
  );

  it.each(moves.filter(({ from, to }) => !ALLOWED.includes(`${from} → ${to}`)))(
    "refuses to move a Task from $from to $to",
    ({ from, to }) => {
      expect(() => changeTaskState(aTaskIn(from), to, THE_USER)).toThrow(TaskRefused);
    },
  );

  it("refuses Ready without a Plan and a Definition of Done, with both reasons", () => {
    expect(() => changeTaskState(aTask({ state: "planning" }), "ready", THE_USER)).toThrow(
      new TaskRefused([
        "A Task needs a Plan before it can be Ready.",
        "A Task needs a Definition of Done before it can be Ready.",
      ]),
    );
  });

  it("marks a Task Ready from Backlog once the user wrote and confirmed both parts", () => {
    const written = aPlannedTask({ state: "backlog" });

    const change = markTaskReady(written, 0);

    expect(change?.task.state).toBe("ready");
    expect(change?.event).toMatchObject({ from: "backlog", to: "ready" });
  });

  it("refuses Mark Ready while the Task has no Pipeline", () => {
    for (const state of ["backlog", "planning"] as const) {
      expect(() => markTaskReady(aPlannedTask({ state, pipelineId: undefined }), 0)).toThrow(
        new TaskRefused(["Choose a Pipeline before the Task can be Ready."]),
      );
    }
  });
});
