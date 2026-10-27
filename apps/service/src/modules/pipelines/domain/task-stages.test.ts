import { describe, expect, it } from "vitest";
import type { Stage } from "./stage.js";
import { agentStage, gate, scriptStage } from "./stage.fixtures.js";
import { aStageRun } from "./stage-run.fixtures.js";
import type { RoleFilling } from "./stage-staffing.js";
import { TaskStagesEdited } from "./task-stages-events.js";
import {
  editProblems,
  editTaskStages,
  followsPipeline,
  lockedStageCount,
  makeTaskStages,
  type TaskStages,
} from "./task-stages.js";

const implement = agentStage();
const tests = scriptStage({ onFailure: { goBackTo: "implement", rounds: 2 } });
const review = agentStage({ key: "review", name: "Review & fix" });
const publish = scriptStage({ key: "publish", name: "Publish", command: "publish" });
const stages: readonly Stage[] = [implement, tests, review, publish];

const own: TaskStages = makeTaskStages(
  "task-1",
  { id: "full", name: "Full", description: "Most work.", stages },
  new Date(0),
).taskStages;

const roles = new Map<string, RoleFilling>([
  ["developer", { title: "Developer", person: { name: "Ada", taskLimit: 2 } }],
  ["cto", { title: "CTO", person: { name: "Nina", taskLimit: "none" } }],
]);

function ranOnce(stageKey: string, number = 1) {
  return aStageRun({ id: `run-${number}`, stageKey, number });
}

describe("lockedStageCount", () => {
  it("locks nothing before the first run", () => {
    expect(lockedStageCount(stages, [])).toBe(0);
  });

  it("locks every Stage up to the furthest one that ran, after a loop went back", () => {
    const runs = [ranOnce("implement", 1), ranOnce("tests", 2), ranOnce("implement", 3)];

    expect(lockedStageCount(stages, runs)).toBe(2);
  });
});

describe("editProblems", () => {
  it("passes an edit of a Task that hasn't started: a Gate before Publish, a model, a reorder", () => {
    const edited = [
      { ...implement, model: "claude-haiku-5-5", effort: "low" as const },
      review,
      tests,
      gate({ key: "look", name: "Look" }),
      publish,
    ];

    expect(editProblems(own, edited, [], roles)).toEqual([]);
  });

  it("passes changes after the started Stages, which stay as they were", () => {
    const edited = [implement, tests, gate({ key: "look", name: "Look" }), publish];

    expect(editProblems(own, edited, [ranOnce("implement"), ranOnce("tests", 2)], roles)).toEqual(
      [],
    );
  });

  it("takes a started Stage read back with its fields in another order as unchanged", () => {
    const reordered = Object.fromEntries(Object.entries(implement).toReversed()) as Stage;

    expect(editProblems(own, [reordered, tests], [ranOnce("implement")], roles)).toEqual([]);
  });

  it("refuses changing, moving, dropping or putting a Stage above a started one", () => {
    const started = [ranOnce("implement")];
    const locked = "Stage 1 · Implement: it has started, so it stays as it is, where it is.";

    expect(editProblems(own, [{ ...implement, budget: 5 }, tests], started, roles)).toContainEqual({
      stageIndex: 0,
      text: locked,
    });
    expect(editProblems(own, [gate(), implement, tests], started, roles)).toContainEqual({
      stageIndex: 0,
      text: locked,
    });
    expect(editProblems(own, [tests, review], started, roles)).toContainEqual({
      stageIndex: 0,
      text: locked,
    });
  });

  it("flags a Role that only talks, on Stages not yet started", () => {
    const edited = [implement, tests, { ...review, role: "cto" }, publish];

    expect(editProblems(own, edited, [], roles).map(({ text }) => text)).toEqual([
      "Stage 3 · Review & fix: Nina's Task limit is none, so CTO only talks and can't work a Stage.",
    ]);
  });

  it("flags continuing a session without the same Role on the Stage before", () => {
    const edited = [implement, tests, { ...review, session: "continue" as const }, publish];

    expect(editProblems(own, edited, [], roles).map(({ text }) => text)).toEqual([
      "Stage 3 · Review & fix: continuing a session needs the same Role in the Stage before.",
    ]);
  });

  it("flags an on-failure target that isn't earlier", () => {
    const edited = [{ ...implement, onFailure: { goBackTo: "review", rounds: 1 } }, review];

    expect(editProblems(own, edited, [], roles).map(({ text }) => text)).toEqual([
      "Stage 1 · Implement: on failure it can only go back to an earlier Stage.",
    ]);
  });
});

describe("editTaskStages", () => {
  it("replaces the Stages and marks the copy edited for the Task", () => {
    const edited = [implement, gate(), publish];

    const { taskStages, event } = editTaskStages(own, edited);

    expect(taskStages).toEqual({ ...own, stages: edited, editedForTask: true });
    // The event's time is its own, so only what it says is compared.
    expect(event).toBeInstanceOf(TaskStagesEdited);
    expect(event).toMatchObject({ taskId: "task-1", pipelineId: "full" });
  });
});

describe("followsPipeline", () => {
  it("leaves a copy behind once the Task's Pipeline was swapped", () => {
    expect(followsPipeline(own, "full")).toBe(true);
    expect(followsPipeline(own, "quick-fix")).toBe(false);
  });
});
