import { describe, expect, it } from "vitest";
import { TASK_STATES, type TaskState } from "./task.js";
import { changeTaskState, markTaskReady } from "./task-changes.js";
import {
  TaskDefinitionOfDoneConfirmed,
  TaskPlanConfirmed,
  TaskStateChanged,
} from "./task-events.js";
import { TaskRefused } from "./task-refused.js";
import { ANN_LEE, aPlannedTask, aTask } from "./work.fixtures.js";

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
      const change = changeTaskState(aTaskIn(from), to, ANN_LEE);

      expect(change?.task.state).toBe(to);
      expect(change?.event).toBeInstanceOf(TaskStateChanged);
      expect(change?.event).toMatchObject({ taskId: "task-1", from, to });
    },
  );

  it.each(moves.filter(({ from, to }) => !ALLOWED.includes(`${from} → ${to}`)))(
    "refuses to move a Task from $from to $to",
    ({ from, to }) => {
      expect(() => changeTaskState(aTaskIn(from), to, ANN_LEE)).toThrow(TaskRefused);
    },
  );

  it("refuses Ready without a Plan and a Definition of Done, with both reasons", () => {
    expect(() => changeTaskState(aTask({ state: "planning" }), "ready", ANN_LEE)).toThrow(
      new TaskRefused([
        "A Task needs a Plan before it can be Ready.",
        "A Task needs a Definition of Done before it can be Ready.",
      ]),
    );
  });

  it("marks a Task Ready from Backlog once the user wrote and confirmed both parts", () => {
    const written = aPlannedTask({ state: "backlog" });

    const change = markTaskReady(written, 0, ANN_LEE);

    expect(change?.task.state).toBe("ready");
    expect(change?.event).toMatchObject({ from: "backlog", to: "ready" });
  });

  it("refuses Mark Ready while the Task has no Pipeline", () => {
    for (const state of ["backlog", "planning"] as const) {
      expect(() =>
        markTaskReady(aPlannedTask({ state, pipelineId: undefined }), 0, ANN_LEE),
      ).toThrow(new TaskRefused(["Choose a Pipeline before the Task can be Ready."]));
    }
  });
});

describe("Mark Ready confirming the Plan and the Definition of Done as they stand", () => {
  const CONFIRMING = { confirmPlanAndDefinitionOfDone: true };

  it("marks an unplanned Task Ready, confirming the empty Plan and Definition of Done, moved by the user", () => {
    const change = markTaskReady(aTask({ state: "backlog" }), 0, ANN_LEE, CONFIRMING);

    expect(change?.task).toMatchObject({
      state: "ready",
      plan: "",
      planConfirmed: true,
      definitionOfDone: [],
      definitionOfDoneConfirmed: true,
    });
    expect(change?.stateChange).toMatchObject({ from: "backlog", to: "ready", by: ANN_LEE });
    expect(change?.event.confirmations).toEqual([
      expect.any(TaskPlanConfirmed),
      expect.any(TaskDefinitionOfDoneConfirmed),
    ]);
    expect(change?.event.confirmations.map(({ taskId }) => taskId)).toEqual(["task-1", "task-1"]);
    expect(change?.event.stateChanged).toMatchObject({
      taskId: "task-1",
      from: "backlog",
      to: "ready",
    });
  });

  it("confirms only what wasn't confirmed: an unconfirmed Definition of Done in Planning", () => {
    const change = markTaskReady(
      aPlannedTask({ definitionOfDoneConfirmed: false }),
      0,
      ANN_LEE,
      CONFIRMING,
    );

    expect(change?.task).toMatchObject({
      state: "ready",
      planConfirmed: true,
      definitionOfDoneConfirmed: true,
    });
    expect(change?.event.confirmations).toEqual([expect.any(TaskDefinitionOfDoneConfirmed)]);
  });

  it("refuses as before without the choice, or with it declined", () => {
    const reasons = new TaskRefused([
      "A Task needs a Plan before it can be Ready.",
      "A Task needs a Definition of Done before it can be Ready.",
    ]);

    expect(() => markTaskReady(aTask({ state: "backlog" }), 0, ANN_LEE)).toThrow(reasons);
    expect(() =>
      markTaskReady(aTask({ state: "backlog" }), 0, ANN_LEE, {
        confirmPlanAndDefinitionOfDone: false,
      }),
    ).toThrow(reasons);
  });

  it("still refuses with no Pipeline, a Pipeline proposal open or a Decision open", () => {
    const proposedPipeline = { pipelineId: "quick-fix", reason: "One small change, tested." };

    expect(() => markTaskReady(aTask({ pipelineId: undefined }), 0, ANN_LEE, CONFIRMING)).toThrow(
      new TaskRefused(["Choose a Pipeline before the Task can be Ready."]),
    );
    expect(() => markTaskReady(aTask({ proposedPipeline }), 0, ANN_LEE, CONFIRMING)).toThrow(
      new TaskRefused(["Take or decline the proposed Pipeline before the Task can be Ready."]),
    );
    expect(() => markTaskReady(aTask(), 1, ANN_LEE, CONFIRMING)).toThrow(
      new TaskRefused(["Answer the open Decision before the Task can be Ready."]),
    );
  });

  it("still refuses a move the state rules don't allow", () => {
    expect(() => markTaskReady(aTask({ state: "shaping" }), 0, ANN_LEE, CONFIRMING)).toThrow(
      new TaskRefused(["A Task in Shaping can't move to Ready: confirm its Initiative first."]),
    );
    expect(markTaskReady(aPlannedTask({ state: "ready" }), 0, ANN_LEE, CONFIRMING)).toBeUndefined();
  });
});
