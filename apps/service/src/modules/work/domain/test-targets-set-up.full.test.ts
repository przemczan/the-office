import { describe, expect, it } from "vitest";
import { addToInitiative } from "./initiative-membership.js";
import { moveProblems } from "./task-move.js";
import { TaskRefused } from "./task-refused.js";
import { isOpenTestTargetsSetUp } from "./test-targets-set-up.js";
import { ANN_LEE, anInitiative, aTask } from "./work.fixtures.js";

/** A "Set up test targets" Task as The Office made them before the chat. */
const setUpTask = aTask({
  id: "task-1",
  title: "Set up test targets",
  projectId: "billing",
  state: "ready",
  pipelineId: "set-up-test-targets",
  madeFor: "test-targets-setup",
});

describe("a Set up test targets Task made before", () => {
  it("can't join an Initiative", () => {
    const active = anInitiative({ id: "sync", state: "active" });

    expect(() =>
      addToInitiative(active, setUpTask, [setUpTask], { worktreeExists: true }, ANN_LEE),
    ).toThrow(
      new TaskRefused([
        '"Set up test targets" is a Project\'s Set up test targets Task, which belongs to no Initiative.',
      ]),
    );
  });

  it("can't move to another Project", () => {
    expect(moveProblems(setUpTask, { stateChanges: [], hasWorktree: true })).toEqual([
      'A "Set up test targets" Task belongs to its Project, so it can\'t move to another.',
    ]);
  });
});

describe("isOpenTestTargetsSetUp", () => {
  it("is a set-up Task neither Done nor Dropped", () => {
    expect(isOpenTestTargetsSetUp({ ...setUpTask, state: "in-progress" })).toBe(true);
    expect(isOpenTestTargetsSetUp({ ...setUpTask, state: "done" })).toBe(false);
    expect(isOpenTestTargetsSetUp({ ...setUpTask, state: "dropped" })).toBe(false);
    expect(isOpenTestTargetsSetUp(aTask({ madeFor: "run-environment-setup" }))).toBe(false);
  });
});
