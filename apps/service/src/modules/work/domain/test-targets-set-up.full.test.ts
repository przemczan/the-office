import { describe, expect, it } from "vitest";
import { addToInitiative } from "./initiative-membership.js";
import { TaskCreated } from "./task-events.js";
import { moveProblems } from "./task-move.js";
import { TaskRefused } from "./task-refused.js";
import { readinessLines } from "./task-states.js";
import {
  createTestTargetsSetUpTask,
  isOpenTestTargetsSetUp,
  SET_UP_TEST_TARGETS_PIPELINE,
  TEST_TARGETS_SET_UP_DEFINITION_OF_DONE,
} from "./test-targets-set-up.js";
import { ANN_LEE, anInitiative, aTask } from "./work.fixtures.js";

const createdAt = new Date("2026-11-20T10:00:00.000Z");

describe("createTestTargetsSetUpTask", () => {
  const { task, event, stateChange } = createTestTargetsSetUpTask(
    "task-1",
    { id: "billing", name: "Billing" },
    { order: "a0", createdBy: ANN_LEE },
    createdAt,
  );

  it("is the Project's set-up Task, Ready on the Set up test targets Pipeline", () => {
    expect(task).toMatchObject({
      id: "task-1",
      title: "Set up test targets",
      projectId: "billing",
      state: "ready",
      pipelineId: SET_UP_TEST_TARGETS_PIPELINE,
      madeFor: "test-targets-setup",
      planConfirmed: true,
      definitionOfDone: TEST_TARGETS_SET_UP_DEFINITION_OF_DONE,
      definitionOfDoneConfirmed: true,
      createdBy: ANN_LEE,
    });
    expect(task.plan).toContain("Propose the test targets of Billing");
    expect(event).toEqual(new TaskCreated(task));
    expect(stateChange).toEqual({ from: undefined, to: "ready", at: createdAt, by: ANN_LEE });
  });

  it("asks for no file changed, the entry points spec 2.12 allows and a propose_test_targets Proposal", () => {
    expect(task.plan).toContain("Change no file");
    expect(task.plan).toContain("Name only the Project's own entry points");
    expect(task.plan).toContain("End with propose_test_targets");
  });

  it("meets every condition of Ready", () => {
    expect(readinessLines(task, 0).flatMap(({ problems }) => problems)).toEqual([]);
  });

  it("can't join an Initiative", () => {
    const active = anInitiative({ id: "sync", state: "active" });

    expect(() => addToInitiative(active, task, [task], { worktreeExists: true }, ANN_LEE)).toThrow(
      new TaskRefused([
        '"Set up test targets" is a Project\'s Set up test targets Task, which belongs to no Initiative.',
      ]),
    );
  });

  it("can't move to another Project", () => {
    expect(moveProblems(task, { stateChanges: [], hasWorktree: true })).toEqual([
      'A "Set up test targets" Task belongs to its Project, so it can\'t move to another.',
    ]);
  });
});

describe("isOpenTestTargetsSetUp", () => {
  const setUpTask = aTask({ madeFor: "test-targets-setup" });

  it("is a set-up Task neither Done nor Dropped", () => {
    expect(isOpenTestTargetsSetUp({ ...setUpTask, state: "in-progress" })).toBe(true);
    expect(isOpenTestTargetsSetUp({ ...setUpTask, state: "done" })).toBe(false);
    expect(isOpenTestTargetsSetUp({ ...setUpTask, state: "dropped" })).toBe(false);
    expect(isOpenTestTargetsSetUp(aTask({ madeFor: "run-environment-setup" }))).toBe(false);
  });
});
