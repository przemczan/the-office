import { describe, expect, it } from "vitest";
import { THE_USER } from "./author.js";
import { TASK_STATES, type TaskState } from "./task.js";
import { changeTaskState, markTaskReady } from "./task-changes.js";
import { TaskStateChanged } from "./task-events.js";
import { TaskRefused } from "./task-refused.js";
import { readinessLines } from "./task-states.js";
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

  it("names both states in the UI's words when it refuses", () => {
    expect(() => changeTaskState(aTask({ state: "backlog" }), "in-progress", THE_USER)).toThrow(
      new TaskRefused(["A Task in Backlog can't move to In progress."]),
    );
  });

  it.each(TASK_STATES)("changes nothing for a Task already in %s", (state) => {
    expect(changeTaskState(aTaskIn(state), state, THE_USER)).toBeUndefined();
  });

  it("refuses Ready without a Plan and a Definition of Done, with both reasons", () => {
    expect(() => changeTaskState(aTask({ state: "planning" }), "ready", THE_USER)).toThrow(
      new TaskRefused([
        "A Task needs a Plan before it can be Ready.",
        "A Task needs a Definition of Done before it can be Ready.",
      ]),
    );
  });

  it("refuses Ready while the Plan and the Definition of Done are only proposed", () => {
    const proposed = aPlannedTask({ planConfirmed: false, definitionOfDoneConfirmed: false });

    expect(() => changeTaskState(proposed, "ready", THE_USER)).toThrow(
      new TaskRefused([
        "Confirm the Plan before the Task can be Ready.",
        "Confirm the Definition of Done before the Task can be Ready.",
      ]),
    );
  });

  it("refuses Ready while a Pipeline proposal waits on the user", () => {
    const proposing = aPlannedTask({
      proposedPipeline: { pipelineId: "quick-fix", reason: "One small change, tested." },
    });

    expect(() => changeTaskState(proposing, "ready", THE_USER)).toThrow(
      new TaskRefused(["Take or decline the proposed Pipeline before the Task can be Ready."]),
    );
    expect(changeTaskState(aPlannedTask(), "ready", THE_USER)?.task.state).toBe("ready");
  });

  it("refuses Mark Ready while a Decision on the Task waits on the user", () => {
    expect(() => markTaskReady(aPlannedTask(), 1)).toThrow(
      new TaskRefused(["Answer the open Decision before the Task can be Ready."]),
    );
    expect(() => markTaskReady(aPlannedTask({ planConfirmed: false }), 2)).toThrow(
      new TaskRefused([
        "Confirm the Plan before the Task can be Ready.",
        "Answer the 2 open Decisions before the Task can be Ready.",
      ]),
    );
    expect(markTaskReady(aPlannedTask(), 0)?.task.state).toBe("ready");
    expect(markTaskReady(aPlannedTask({ state: "ready" }), 1)).toBeUndefined();
  });

  it("refuses Ready with a Plan of spaces only", () => {
    expect(() => changeTaskState(aPlannedTask({ plan: "  " }), "ready", THE_USER)).toThrow(
      new TaskRefused(["A Task needs a Plan before it can be Ready."]),
    );
  });
});

describe("the Before Ready checklist", () => {
  const proposedPipeline = { pipelineId: "quick-fix", reason: "One small change, tested." };

  it("lists the four conditions in order, all met for a Task that can be Ready", () => {
    const lines = readinessLines(aPlannedTask(), 0);

    expect(lines.map(({ label }) => label)).toEqual([
      "Plan confirmed",
      "Definition of Done confirmed",
      "Pipeline taken or declined",
      "No Decision waiting",
    ]);
    expect(lines.every(({ problems }) => problems.length === 0)).toBe(true);
  });

  it.each([
    ["nothing written", aTask({ state: "planning" }), 0, 2],
    [
      "only proposed",
      aPlannedTask({ planConfirmed: false, definitionOfDoneConfirmed: false }),
      0,
      2,
    ],
    ["a Pipeline proposal open", aPlannedTask({ proposedPipeline }), 0, 1],
    ["a Decision waiting", aPlannedTask(), 1, 1],
    ["everything open", aPlannedTask({ planConfirmed: false, proposedPipeline }), 3, 3],
  ])("has the refusal's reasons when %s", (_name, task, openDecisions, unmetLines) => {
    const lines = readinessLines(task, openDecisions);
    const reasons = lines.flatMap(({ problems }) => problems);

    expect(lines.filter(({ problems }) => problems.length > 0)).toHaveLength(unmetLines);
    expect(() => markTaskReady(task, openDecisions)).toThrow(new TaskRefused(reasons));
  });
});
