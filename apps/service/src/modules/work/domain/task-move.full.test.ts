import { describe, expect, it } from "vitest";
import { THE_USER } from "./author.js";
import type { StateChange } from "./state-change.js";
import type { Task } from "./task.js";
import { TaskMovedToProject, TaskStateChanged } from "./task-events.js";
import { moveProblems, moveTask, type MoveGrounds } from "./task-move.js";
import { TaskRefused } from "./task-refused.js";
import { aPlannedTask, aTask } from "./work.fixtures.js";

const CREATED_AT = new Date("2026-10-25T09:30:00.000Z");
const CREATED: StateChange = { from: undefined, to: "backlog", at: CREATED_AT, by: THE_USER };
const NEVER_PLANNED: MoveGrounds = { stateChanges: [CREATED], hasWorktree: false };
const TO_SHOP = "shop";

/** A Task the user wrote and marked Ready from Backlog, never planned. */
function aReadyTask(fields: Partial<Task> = {}): Task {
  return aPlannedTask({ state: "ready", ...fields });
}

const READY_FROM_BACKLOG: MoveGrounds = {
  stateChanges: [CREATED, { from: "backlog", to: "ready", at: CREATED_AT, by: THE_USER }],
  hasWorktree: false,
};

describe("moveProblems", () => {
  it("lets a Task in Backlog, Ready or Shaping that was never planned move", () => {
    expect(moveProblems(aTask(), NEVER_PLANNED)).toEqual([]);
    expect(moveProblems(aReadyTask(), READY_FROM_BACKLOG)).toEqual([]);
    const shaping: StateChange = { ...CREATED, to: "shaping" };
    expect(
      moveProblems(aTask({ state: "shaping" }), { ...NEVER_PLANNED, stateChanges: [shaping] }),
    ).toEqual([]);
  });

  it("refuses an Onboard Task, which belongs to its Project", () => {
    expect(moveProblems(aReadyTask({ madeFor: "onboard" }), READY_FROM_BACKLOG)).toEqual([
      "An Onboard Task belongs to its Project, so it can't move to another.",
    ]);
  });

  it("refuses a set-up Task, which belongs to its Project", () => {
    expect(
      moveProblems(aReadyTask({ madeFor: "run-environment-setup" }), READY_FROM_BACKLOG),
    ).toEqual([
      'A "Set up the run environment" Task belongs to its Project, so it can\'t move to another.',
    ]);
  });

  it.each(["in-progress", "waiting-on-you", "paused", "done", "dropped"] as const)(
    "refuses a Task in %s, which has started or ended",
    (state) => {
      expect(moveProblems(aTask({ state }), NEVER_PLANNED)).toContainEqual(
        expect.stringContaining("once it has started or ended"),
      );
    },
  );

  it("refuses a Task in Planning", () => {
    expect(moveProblems(aTask({ state: "planning" }), NEVER_PLANNED)).toEqual([
      "A Task can't move to another Project once it has entered Planning: it was planned for this one.",
    ]);
  });

  it("refuses a Task that entered Planning even after a changing Save returned it to Backlog", () => {
    const grounds: MoveGrounds = {
      stateChanges: [
        CREATED,
        { from: "backlog", to: "planning", at: CREATED_AT, by: THE_USER },
        { from: "planning", to: "ready", at: CREATED_AT, by: THE_USER },
        { from: "ready", to: "backlog", at: CREATED_AT, by: THE_USER },
      ],
      hasWorktree: false,
    };

    expect(moveProblems(aTask(), grounds)).toEqual([
      expect.stringContaining("once it has entered Planning"),
    ]);
  });

  it("refuses a Task whose state changes weren't kept from its creation, saying why", () => {
    const sinceKeeping: StateChange = {
      from: "backlog",
      to: "ready",
      at: CREATED_AT,
      by: THE_USER,
    };

    for (const stateChanges of [[], [sinceKeeping]]) {
      expect(moveProblems(aReadyTask(), { stateChanges, hasWorktree: false })).toEqual([
        "The Task is older than the state changes The Office keeps, so it can't tell whether the Task was planned for its Project; it can't move to another.",
      ]);
    }
  });

  it("refuses a Task with a worktree in its Project", () => {
    expect(moveProblems(aReadyTask(), { ...READY_FROM_BACKLOG, hasWorktree: true })).toEqual([
      "The Task has a worktree in its Project, so it can't move to another.",
    ]);
  });

  it("gives every reason at once", () => {
    const problems = moveProblems(aTask({ state: "in-progress" }), {
      stateChanges: [],
      hasWorktree: true,
    });

    expect(problems).toHaveLength(3);
  });
});

describe("moveTask", () => {
  it("puts the Task in the Project with no Pipeline, both parts Not confirmed and kept", () => {
    const task = aReadyTask({
      state: "backlog",
      filesToChange: ["src/login.ts"],
      estimatedTokens: 120_000,
      proposedPipeline: { pipelineId: "full", reason: "It needs a review." },
    });

    const change = moveTask(task, TO_SHOP, NEVER_PLANNED, THE_USER);

    expect(change?.task).toMatchObject({
      projectId: "shop",
      pipelineId: undefined,
      proposedPipeline: undefined,
      state: "backlog",
      plan: task.plan,
      planConfirmed: false,
      filesToChange: ["src/login.ts"],
      estimatedTokens: 120_000,
      definitionOfDone: task.definitionOfDone,
      definitionOfDoneConfirmed: false,
    });
    expect(change?.stateChange).toBeUndefined();
    expect(change?.event).toBeInstanceOf(TaskMovedToProject);
    expect(change?.event).toMatchObject({
      taskId: "task-1",
      fromProjectId: "admin-panel",
      toProjectId: "shop",
      leftReady: undefined,
    });
  });

  it("keeps the Initiative, the dependencies, the Idea and the place on the board", () => {
    const task = aTask({
      initiativeId: "initiative-1",
      blockedBy: ["task-2"],
      originIdeaId: "idea-1",
      order: "a5",
      priority: "high",
    });

    expect(moveTask(task, TO_SHOP, NEVER_PLANNED, THE_USER)?.task).toMatchObject({
      initiativeId: "initiative-1",
      blockedBy: ["task-2"],
      originIdeaId: "idea-1",
      order: "a5",
      priority: "high",
    });
  });

  it("keeps the Move in the Task, after any earlier one", () => {
    const earlier = { from: "docs", to: "admin-panel", at: CREATED_AT, by: THE_USER };

    const change = moveTask(aTask({ projectMoves: [earlier] }), TO_SHOP, NEVER_PLANNED, THE_USER);

    expect(change?.task.projectMoves).toEqual([
      earlier,
      { from: "admin-panel", to: "shop", at: change?.event.occurredAt, by: THE_USER },
    ]);
  });

  it("takes a Ready Task back to Backlog in the same save, its move kept", () => {
    const change = moveTask(aReadyTask(), TO_SHOP, READY_FROM_BACKLOG, THE_USER);

    expect(change?.task.state).toBe("backlog");
    expect(change?.event.leftReady).toBeInstanceOf(TaskStateChanged);
    expect(change?.event.leftReady).toMatchObject({ from: "ready", to: "backlog" });
    expect(change?.stateChange).toMatchObject({ from: "ready", to: "backlog", by: THE_USER });
  });

  it("leaves a Task in Shaping there, for Confirm alone to move on", () => {
    const shaping: StateChange = { ...CREATED, to: "shaping" };

    const change = moveTask(
      aTask({ state: "shaping" }),
      TO_SHOP,
      { stateChanges: [shaping], hasWorktree: false },
      THE_USER,
    );

    expect(change?.task).toMatchObject({ state: "shaping", projectId: "shop" });
    expect(change?.stateChange).toBeUndefined();
  });

  it("changes nothing for the Project the Task is in", () => {
    expect(moveTask(aTask(), "admin-panel", NEVER_PLANNED, THE_USER)).toBeUndefined();
  });

  it("refuses with every reason", () => {
    expect(() =>
      moveTask(aTask(), TO_SHOP, { ...NEVER_PLANNED, hasWorktree: true }, THE_USER),
    ).toThrow(TaskRefused);
  });
});
