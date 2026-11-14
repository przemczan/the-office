import { describe, expect, it } from "vitest";
import { addToInitiative, takeOutOfInitiative } from "./initiative-membership.js";
import {
  TaskAddedToInitiative,
  TaskDependencyAdded,
  TaskDependencyRemoved,
  TaskStateChanged,
  TaskTakenOutOfInitiative,
} from "./task-events.js";
import { TaskRefused } from "./task-refused.js";
import { ANN_LEE, anInitiative, aTask } from "./work.fixtures.js";

const NO_WORKTREE = { worktreeExists: false };
const shaping = anInitiative({ id: "sync", name: "Offline sync", state: "shaping" });
const active = anInitiative({ id: "sync", name: "Offline sync", state: "active" });
const onPipeline = { ...active, pipelines: [{ projectId: "firmware", pipelineId: "full" }] };
const schema = aTask({ id: "schema", title: "Queue schema", projectId: "firmware" });

describe("addToInitiative", () => {
  it("moves a Backlog Task joining an Initiative being shaped to Shaping, kept as the user's move", () => {
    const { task, publishing } =
      addToInitiative(shaping, schema, [schema], NO_WORKTREE, ANN_LEE) ?? {};

    expect(task?.task).toMatchObject({ initiativeId: "sync", state: "shaping" });
    expect(task?.stateChange).toMatchObject({ from: "backlog", to: "shaping", by: ANN_LEE });
    expect(task?.event).toBeInstanceOf(TaskAddedToInitiative);
    expect(task?.event.stateChanged).toBeInstanceOf(TaskStateChanged);
    expect(publishing).toBeUndefined();
  });

  it("keeps the state of a Task joining an active Initiative, and its Publishing Task waits for it", () => {
    const ready = { ...schema, state: "ready" as const };
    const publishing = aTask({
      id: "publish",
      projectId: "firmware",
      madeFor: "publishing",
      initiativeId: "sync",
      state: "ready",
    });

    const added = addToInitiative(active, ready, [ready, publishing], NO_WORKTREE, ANN_LEE);

    expect(added?.task.task).toMatchObject({ initiativeId: "sync", state: "ready" });
    expect(added?.task.stateChange).toBeUndefined();
    expect(added?.task.event.stateChanged).toBeUndefined();
    expect(added?.publishing?.task.blockedBy).toEqual(["schema"]);
    expect(added?.publishing?.event).toBeInstanceOf(TaskDependencyAdded);
  });

  it("changes nothing for a Task in the Initiative already", () => {
    const joined = { ...schema, initiativeId: "sync" };

    expect(addToInitiative(active, joined, [joined], NO_WORKTREE, ANN_LEE)).toBeUndefined();
  });

  it("refuses a Task in another Initiative, one started, and a done Initiative, with every reason", () => {
    const started = { ...schema, state: "in-progress" as const, initiativeId: "other" };

    expect(() =>
      addToInitiative({ ...active, state: "done" }, started, [started], NO_WORKTREE, ANN_LEE),
    ).toThrow(
      new TaskRefused([
        'A Task joins an Initiative before it starts; "Queue schema" is In progress.',
        '"Queue schema" is in another Initiative already, and a Task is in at most one: take it out of that one first.',
        "A done Initiative takes no more Tasks.",
      ]),
    );
  });

  it("refuses a Task The Office made, and a Task not in Backlog for an Initiative being shaped", () => {
    const onboard = { ...schema, madeFor: "onboard" as const };
    const planning = { ...schema, state: "planning" as const };

    expect(() => addToInitiative(shaping, onboard, [onboard], NO_WORKTREE, ANN_LEE)).toThrow(
      new TaskRefused([
        '"Queue schema" is a Project\'s Onboard Task, which belongs to no Initiative.',
      ]),
    );
    expect(() => addToInitiative(shaping, planning, [planning], NO_WORKTREE, ANN_LEE)).toThrow(
      new TaskRefused([
        'Only a Task in Backlog joins an Initiative being shaped; "Queue schema" is in Planning.',
      ]),
    );
  });

  it("refuses a Task whose worktree came from the base branch when the Initiative has a Pipeline there", () => {
    expect(() =>
      addToInitiative(onPipeline, schema, [schema], { worktreeExists: true }, ANN_LEE),
    ).toThrow(
      new TaskRefused([
        '"Queue schema" has a worktree made from the base branch, and the Initiative\'s Tasks in firmware work from its branch there.',
      ]),
    );
    expect(
      addToInitiative(active, schema, [schema], { worktreeExists: true }, ANN_LEE),
    ).toBeDefined();
  });
});

describe("takeOutOfInitiative", () => {
  const inIt = { ...schema, initiativeId: "sync" };

  it("moves a Task in Shaping back to Backlog, kept as the user's move", () => {
    const shaped = { ...inIt, state: "shaping" as const };

    const { task } = takeOutOfInitiative(shaping, shaped, [shaped], NO_WORKTREE, ANN_LEE);

    expect(task.task).toMatchObject({ initiativeId: undefined, state: "backlog" });
    expect(task.stateChange).toMatchObject({ from: "shaping", to: "backlog", by: ANN_LEE });
    expect(task.event).toBeInstanceOf(TaskTakenOutOfInitiative);
  });

  it("moves a Task planned in the Initiative's planning Thread to Backlog, without that Thread", () => {
    const planned = {
      ...inIt,
      state: "planning" as const,
      initiativePlanningThreadId: "thread",
      hasPlanningThread: true,
      markedPlanned: true,
    };

    const { task } = takeOutOfInitiative(active, planned, [planned], NO_WORKTREE, ANN_LEE);

    expect(task.task).toMatchObject({
      state: "backlog",
      initiativePlanningThreadId: undefined,
      hasPlanningThread: false,
      markedPlanned: false,
    });
  });

  it("keeps a Ready Task Ready, no longer planned in the Initiative's Thread", () => {
    const ready = {
      ...inIt,
      state: "ready" as const,
      initiativePlanningThreadId: "thread",
      hasPlanningThread: true,
      markedPlanned: true,
    };

    const { task } = takeOutOfInitiative(active, ready, [ready], NO_WORKTREE, ANN_LEE);

    expect(task.task).toMatchObject({
      state: "ready",
      initiativePlanningThreadId: undefined,
      hasPlanningThread: false,
      markedPlanned: true,
    });
    expect(task.stateChange).toBeUndefined();
  });

  it("lets the Publishing Task stop waiting for it, keeping its other dependencies", () => {
    const waiting = { ...inIt, blockedBy: ["other"] };
    const publishing = aTask({
      id: "publish",
      projectId: "firmware",
      madeFor: "publishing",
      initiativeId: "sync",
      state: "ready",
      blockedBy: ["schema", "other"],
    });

    const { task, publishing: unblocked } = takeOutOfInitiative(
      active,
      waiting,
      [waiting, publishing],
      NO_WORKTREE,
      ANN_LEE,
    );

    expect(task.task.blockedBy).toEqual(["other"]);
    expect(unblocked?.task.blockedBy).toEqual(["other"]);
    expect(unblocked?.event).toBeInstanceOf(TaskDependencyRemoved);
  });

  it("refuses a started Task, a Publishing Task and a Task of another Initiative", () => {
    const started = { ...inIt, state: "paused" as const };
    const publishing = { ...inIt, madeFor: "publishing" as const };
    const elsewhere = { ...schema, initiativeId: "other" };

    expect(() => takeOutOfInitiative(active, started, [], NO_WORKTREE, ANN_LEE)).toThrow(
      new TaskRefused(['A Task leaves its Initiative before it starts; "Queue schema" is Paused.']),
    );
    expect(() => takeOutOfInitiative(active, publishing, [], NO_WORKTREE, ANN_LEE)).toThrow(
      new TaskRefused([
        '"Queue schema" is an Initiative\'s Publishing Task, which stays with its Initiative.',
      ]),
    );
    expect(() => takeOutOfInitiative(active, elsewhere, [], NO_WORKTREE, ANN_LEE)).toThrow(
      new TaskRefused(['"Queue schema" isn\'t in the Initiative "Offline sync".']),
    );
  });

  it("refuses a Task whose worktree was made from the Initiative's branch", () => {
    expect(() =>
      takeOutOfInitiative(onPipeline, inIt, [inIt], { worktreeExists: true }, ANN_LEE),
    ).toThrow(
      new TaskRefused([
        '"Queue schema" has a worktree made from the Initiative\'s branch, so it stays in the Initiative.',
      ]),
    );
  });
});
