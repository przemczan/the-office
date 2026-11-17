import { describe, expect, it } from "vitest";
import { straightLineFlow } from "./flow.js";
import { gate } from "./stage.fixtures.js";
import { aStageRun } from "./stage-run.fixtures.js";
import { TaskStagesEdited } from "./task-stages-events.js";
import { editProblems, editTaskStages, firstStageToWork } from "./task-stages.js";
import {
  implement,
  tests,
  review,
  publish,
  stages,
  own,
  roles,
  ranOnce,
} from "./task-stages.fixtures.js";

describe("firstStageToWork", () => {
  it("is the Stage after the last one that finished", () => {
    expect(firstStageToWork(stages, [ranOnce("implement", 1), ranOnce("tests", 2)])).toBe(2);
  });

  it("is the Stage the last run left unfinished, which runs again", () => {
    const paused = aStageRun({
      stageKey: "tests",
      number: 2,
      outcome: { status: "failed", error: "Paused.", interrupted: "pause" },
    });

    expect(firstStageToWork(stages, [ranOnce("implement", 1), paused])).toBe(1);
  });

  it("is the first Stage before any run", () => {
    expect(firstStageToWork(stages, [])).toBe(0);
  });
});

describe("editProblems", () => {
  it("refuses changing, moving, dropping or putting a Stage above a started one", () => {
    const started = [ranOnce("implement")];
    const locked = "Stage 1 · Implement: it has started, so it stays as it is, where it is.";

    expect(editProblems(own, [{ ...implement, budget: 5 }, tests], started, roles)).toContainEqual({
      stageKey: "implement",
      at: { kind: "stage" },
      level: "problem",
      text: locked,
    });
    expect(editProblems(own, [gate(), implement, tests], started, roles)).toContainEqual({
      stageKey: "implement",
      at: { kind: "stage" },
      level: "problem",
      text: locked,
    });
    expect(editProblems(own, [tests, review], started, roles)).toContainEqual({
      stageKey: "implement",
      at: { kind: "stage" },
      level: "problem",
      text: locked,
    });
  });
});

describe("editTaskStages", () => {
  it("replaces the Stages and marks the copy edited for the Task", () => {
    const edited = [implement, gate(), publish];

    const { taskStages, event } = editTaskStages(own, edited);

    expect(taskStages).toEqual({
      ...own,
      stages: straightLineFlow(edited),
      editedForTask: true,
    });
    // The event's time is its own, so only what it says is compared.
    expect(event).toBeInstanceOf(TaskStagesEdited);
    expect(event).toMatchObject({ taskId: "task-1", pipelineId: "full" });
  });
});
