import { describe, expect, it } from "vitest";
import type { FlowStage } from "./flow.js";
import type { StageProblem } from "./pipeline.js";
import type { ConditionGroup } from "./route.js";
import type { Stage } from "./stage.js";
import {
  agentStage,
  gate,
  goingBackOnFailure,
  scriptStage,
  straightLine,
} from "./stage.fixtures.js";
import type { StageRun } from "./stage-run.js";
import { aStageRun } from "./stage-run.fixtures.js";
import { TaskStagesEdited } from "./task-stages-events.js";
import { editProblems, editTaskStages, firstStageToWork, makeTaskStages } from "./task-stages.js";
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

const ROUTES_OUT =
  "it has started, so its routes out stay as they are. To change where the walk goes, change the routes of a Stage that hasn't started.";

/** The fixture's Stages as a straight line, `implement` and `tests` started. */
const line = straightLine(stages);
const started = [ranOnce("implement", 1), ranOnce("tests", 2)];

function lockProblems(
  edited: readonly Stage[],
  ownStages: readonly Stage[] = line,
  runs: readonly StageRun[] = started,
): StageProblem[] {
  return editProblems({ ...own, stages: ownStages }, edited, runs, roles).filter(({ text }) =>
    text.includes("it has started"),
  );
}

/** `line` with the Stage at `key` changed by `change`. */
function withStage(key: string, change: (stage: FlowStage) => FlowStage): FlowStage[] {
  return line.map((stage) => (stage.key === key ? change(stage) : stage));
}

const failed: ConditionGroup = {
  combine: "all",
  tests: [{ kind: "stage", stage: null, is: "failed" }],
};

describe("editProblems", () => {
  it("refuses changing a started Stage's fields, or removing it", () => {
    expect(
      editProblems(own, [{ ...implement, budget: 5 }, tests], [ranOnce("implement")], roles),
    ).toContainEqual({
      stageKey: "implement",
      at: { kind: "stage" },
      level: "problem",
      text: "Stage 1 · Implement: it has started, so it stays as it is.",
    });
    expect(lockProblems(line.filter(({ key }) => key !== "tests"))).toEqual([
      {
        stageKey: "tests",
        at: { kind: "stage" },
        level: "problem",
        text: "Stage 2 · Tests: it has started, so it can't be removed.",
      },
    ]);
  });

  it("refuses a started Stage's route changed or reordered, on that route", () => {
    const retargeted = withStage("tests", (stage) => ({
      ...stage,
      routes: [{ to: "publish", condition: null, limit: null }],
    }));
    const branching = withStage("tests", (stage) => ({
      ...stage,
      routes: [
        { to: "review", condition: failed, limit: null },
        { to: "publish", condition: null, limit: null },
      ],
    }));
    const reordered = branching.map((stage) =>
      stage.key === "tests" ? { ...stage, routes: stage.routes.toReversed() } : stage,
    );

    // Tests' first route is the failure route back its on-failure setting reads as.
    expect(lockProblems(retargeted)).toEqual([
      {
        stageKey: "tests",
        at: { kind: "route", routeIndex: 1 },
        level: "problem",
        text: `Stage 2 · Tests: ${ROUTES_OUT}`,
      },
    ]);
    expect(lockProblems(reordered, branching).map(({ at }) => at)).toEqual([
      { kind: "route", routeIndex: 1 },
    ]);
  });

  it("refuses a started Stage's condition changed, on its route", () => {
    const conditioned = withStage("implement", (stage) => ({
      ...stage,
      routes: [{ to: "tests", condition: failed, limit: null }],
    }));

    expect(lockProblems(conditioned).map(({ stageKey, at }) => ({ stageKey, at }))).toEqual([
      { stageKey: "implement", at: { kind: "route", routeIndex: 0 } },
    ]);
  });

  it("refuses a route added to or removed from a started Stage, on the Stage", () => {
    const added = withStage("tests", (stage) => ({
      ...stage,
      routes: [...stage.routes, { to: "publish", condition: null, limit: null }],
    }));
    const removed = withStage("tests", (stage) => ({ ...stage, routes: [] }));

    expect(lockProblems(added)).toEqual([
      {
        stageKey: "tests",
        at: { kind: "stage" },
        level: "problem",
        text: `Stage 2 · Tests: ${ROUTES_OUT}`,
      },
    ]);
    expect(lockProblems(removed).map(({ text }) => text)).toEqual([
      `Stage 2 · Tests: ${ROUTES_OUT}`,
    ]);
  });

  it("lets a started Stage move anywhere on the canvas, as where it stands is layout alone", () => {
    const moved = withStage("implement", (stage) => ({ ...stage, position: { x: 900, y: -300 } }));

    expect(editProblems({ ...own, stages: line }, moved, started, roles)).toEqual([]);
  });

  it("refuses a started Stage moved in the Pipeline's order", () => {
    const [first, second, ...rest] = line as [FlowStage, FlowStage, ...FlowStage[]];

    expect(lockProblems([second, first, ...rest]).map(({ text }) => text)).toEqual([
      "Stage 2 · Implement: it has started, so it keeps its place in the order.",
      "Stage 1 · Tests: it has started, so it keeps its place in the order.",
    ]);
  });

  it("refuses a Stage that hasn't started moved or added among the started ones", () => {
    const [first, second, third, fourth] = line as [FlowStage, FlowStage, FlowStage, FlowStage];
    const look: FlowStage = {
      ...gate({ key: "look", name: "Look" }),
      routes: [{ to: "tests", condition: null, limit: null }],
      position: { x: 0, y: 200 },
    };

    expect(
      editProblems({ ...own, stages: line }, [first, third, second, fourth], started, roles).map(
        ({ text }) => text,
      ),
    ).toEqual(
      expect.arrayContaining([
        "Stage 3 · Tests: it has started, so it keeps its place in the order.",
        "Stage 2 · Review & fix: the Pipeline's order up to Tests, which has started, stays as it is.",
      ]),
    );
    expect(
      editProblems({ ...own, stages: line }, [first, look, second, third, fourth], started, roles)
        .map(({ text }) => text)
        .filter((text) => text.includes("order")),
    ).toEqual([
      "Stage 3 · Tests: it has started, so it keeps its place in the order.",
      "Stage 2 · Look: the Pipeline's order up to Tests, which has started, stays as it is.",
    ]);
  });

  it("refuses a Stage inserted straight after the last started one, with the routes-out words", () => {
    const edited = straightLine([
      implement,
      tests,
      gate({ key: "look", name: "Look" }),
      review,
      publish,
    ]);

    expect(lockProblems(edited)).toEqual([
      {
        stageKey: "tests",
        at: { kind: "route", routeIndex: 1 },
        level: "problem",
        text: `Stage 2 · Tests: ${ROUTES_OUT}`,
      },
    ]);
  });

  it("refuses a started Stage's route limit changed, on that route", () => {
    const limited = withStage("tests", (stage) => goingBackOnFailure(stage, "implement", 3));

    expect(lockProblems(limited).map(({ at }) => at)).toEqual([{ kind: "route", routeIndex: 0 }]);
  });

  it("passes a Stage inserted after one that hasn't started", () => {
    const edited = straightLine([
      implement,
      tests,
      review,
      gate({ key: "look", name: "Look" }),
      publish,
    ]);

    expect(editProblems({ ...own, stages: line }, edited, started, roles)).toEqual([]);
  });

  describe("with a Not taken Stage earlier than a started one", () => {
    const fix = agentStage({ key: "fix", name: "Fix" });
    const check = scriptStage({ key: "check", name: "Check", command: "test" });
    // implement → fix → check → review on failure, else straight to review, which ran.
    const branching: FlowStage[] = [
      {
        ...implement,
        routes: [
          { to: "fix", condition: failed, limit: null },
          { to: "review", condition: null, limit: null },
        ],
        position: { x: 0, y: 0 },
      },
      {
        ...fix,
        routes: [{ to: "check", condition: null, limit: null }],
        position: { x: 308, y: 0 },
      },
      {
        ...check,
        routes: [{ to: "review", condition: null, limit: null }],
        position: { x: 616, y: 0 },
      },
      {
        ...review,
        routes: [{ to: null, condition: null, limit: null }],
        position: { x: 924, y: 0 },
      },
    ];
    const ran = [ranOnce("implement", 1), ranOnce("review", 2)];
    const [first, notTaken, , last] = branching;

    it("passes it edited, or removed with the routes into it changed", () => {
      if (!first || !notTaken || !last) throw new Error("The flow has four Stages.");
      const rerouted = { ...notTaken, routes: [{ to: "review", condition: null, limit: null }] };

      expect(
        editProblems(
          { ...own, stages: branching },
          branching.map((stage) => (stage.key === "fix" ? { ...stage, budget: 9 } : stage)),
          ran,
          roles,
        ),
      ).toEqual([]);
      expect(
        editProblems({ ...own, stages: branching }, [first, rerouted, last], ran, roles),
      ).toEqual([]);
    });

    it("passes a new route from it into a started Stage", () => {
      const intoReview = branching.map((stage) =>
        stage.key === "fix"
          ? {
              ...stage,
              routes: [{ to: "review", condition: failed, limit: null }, ...stage.routes],
            }
          : stage,
      );

      expect(editProblems({ ...own, stages: branching }, intoReview, ran, roles)).toEqual([]);
    });
  });

  it("takes routes differing only in the Stages' names as unchanged", () => {
    const named = withStage("tests", (stage) => ({
      ...stage,
      routes: [
        {
          to: "review",
          toName: "Review",
          condition: {
            combine: "all",
            tests: [{ kind: "stage", stage: "implement", stageName: "Old", is: "done" }],
          },
          limit: null,
        },
      ],
    }));
    const renamed = withStage("tests", (stage) => ({
      ...stage,
      routes: [
        {
          to: "review",
          condition: { combine: "all", tests: [{ kind: "stage", stage: "implement", is: "done" }] },
          limit: null,
        },
      ],
    }));

    expect(lockProblems(renamed, named)).toEqual([]);
  });

  it("takes a started Stage read back with its fields in another order as unchanged", () => {
    const reordered = line.map(
      (stage) => Object.fromEntries(Object.entries(stage).toReversed()) as Stage,
    );

    expect(lockProblems(reordered)).toEqual([]);
  });
});

describe("editTaskStages", () => {
  it("replaces the Stages and marks the copy edited for the Task", () => {
    const edited = [implement, gate(), publish];

    const { taskStages, event } = editTaskStages(own, edited, { x: 1000, y: 20 });

    expect(taskStages).toEqual({
      ...own,
      stages: straightLine(edited),
      endPosition: { x: 1000, y: 20 },
      editedForTask: true,
    });
    // The event's time is its own, so only what it says is compared.
    expect(event).toBeInstanceOf(TaskStagesEdited);
    expect(event).toMatchObject({ taskId: "task-1", pipelineId: "full" });
  });

  it("never keeps a Stage's link to its template: a Task's Stages are copies", () => {
    const { taskStages } = editTaskStages(
      own,
      [{ ...implement, templateId: "review" }, publish],
      undefined,
    );

    expect(taskStages.stages.map(({ templateId }) => templateId)).toEqual([undefined, undefined]);
  });
});

describe("makeTaskStages", () => {
  it("copies the Pipeline's End where it stands", () => {
    const { taskStages } = makeTaskStages(
      "task-1",
      {
        id: "full",
        name: "Full",
        description: "",
        stages: [implement],
        endPosition: { x: 5, y: 6 },
      },
      new Date(),
    );

    expect(taskStages.endPosition).toEqual({ x: 5, y: 6 });
  });

  it("copies the Pipeline's Stages without their links to templates", () => {
    const linked = straightLine([{ ...implement, templateId: "review" }, publish]);

    const { taskStages } = makeTaskStages(
      "task-1",
      { id: "full", name: "Full", description: "", stages: linked },
      new Date(),
    );

    expect(taskStages.stages).toEqual(linked.map(({ templateId: _templateId, ...stage }) => stage));
  });
});
