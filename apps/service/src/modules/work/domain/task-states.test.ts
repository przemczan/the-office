import { describe, expect, it } from "vitest";
import { TASK_STATES, type TaskState } from "./task.js";
import { changeTaskState } from "./task-changes.js";
import { TaskStateChanged } from "./task-events.js";
import { TaskRefused } from "./task-refused.js";
import { aPlannedTask, aTask } from "./work.fixtures.js";

/** Spec §2.1, written out here apart from the rules so that a change to either shows. */
const ALLOWED: readonly string[] = [
  "backlog → planning",
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
      const change = changeTaskState(aTaskIn(from), to);

      expect(change?.task.state).toBe(to);
      expect(change?.event).toBeInstanceOf(TaskStateChanged);
      expect(change?.event).toMatchObject({ taskId: "task-1", from, to });
    },
  );

  it.each(moves.filter(({ from, to }) => !ALLOWED.includes(`${from} → ${to}`)))(
    "refuses to move a Task from $from to $to",
    ({ from, to }) => {
      expect(() => changeTaskState(aTaskIn(from), to)).toThrow(TaskRefused);
    },
  );

  it("names both states in the UI's words when it refuses", () => {
    expect(() => changeTaskState(aTask({ state: "backlog" }), "in-progress")).toThrow(
      new TaskRefused(["A Task in Backlog can't move to In progress."]),
    );
  });

  it.each(TASK_STATES)("changes nothing for a Task already in %s", (state) => {
    expect(changeTaskState(aTaskIn(state), state)).toBeUndefined();
  });

  it("refuses Ready without a Plan and a Definition of Done, with both reasons", () => {
    expect(() => changeTaskState(aTask({ state: "planning" }), "ready")).toThrow(
      new TaskRefused([
        "A Task needs a Plan before it can be Ready.",
        "A Task needs a Definition of Done before it can be Ready.",
      ]),
    );
  });

  it("refuses Ready with a Plan of spaces only", () => {
    expect(() => changeTaskState(aPlannedTask({ plan: "  " }), "ready")).toThrow(
      new TaskRefused(["A Task needs a Plan before it can be Ready."]),
    );
  });
});
