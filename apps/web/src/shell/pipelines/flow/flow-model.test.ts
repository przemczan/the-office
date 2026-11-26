import type { ConditionGroup, Stage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  asFlow,
  canMoveRoute,
  canMoveStage,
  choiceCondition,
  choiceWordsOf,
  endedResults,
  endsCondition,
  FAILED_CONDITION,
  formsToAdd,
  isRouteBack,
  laterStages,
  positionsOf,
  routeFormOf,
  routesMoved,
  stepInOrder,
  withPositions,
  withRouteAdded,
  withRouteCondition,
  withRouteDrawn,
  withRouteLimit,
  withRouteMoved,
  withRouteRemoved,
  withRouteTarget,
  withStageAdded,
  withStageMoved,
  withStageOnRoute,
  withStagePositioned,
  withStageRemovedFromFlow,
} from "./flow-model.ts";
import { isConvertedFlow } from "./converted-flow.ts";
import { canvasEdited } from "./office-flow-edits.ts";

const plan: Stage = { kind: "gate", key: "plan", name: "Plan", optional: false };
const tests: Stage = {
  kind: "script",
  key: "tests",
  name: "Tests",
  optional: false,
  command: "test",
};
const review: Stage = { kind: "gate", key: "review", name: "Review", optional: false };
const publish: Stage = { kind: "publish", key: "publish", name: "Publish", optional: false };
const gate: Stage = { kind: "gate", key: "", name: "Gate", optional: false };
const changed: ConditionGroup = {
  combine: "all",
  tests: [{ kind: "stage", stage: null, is: "changed" }],
};

const line = asFlow([plan, tests, publish]);
const positions = (stages: readonly Stage[]) =>
  stages.map(({ key, position }) => [key, position?.x, position?.y]);
const keys = (stages: readonly Stage[]) => stages.map(({ key }) => key);
const routesOf = (stages: readonly Stage[], key: string) =>
  stages.find((stage) => stage.key === key)?.routes;

describe("a flow", () => {
  it("is given positions in one row and straight routes where Stages lack them", () => {
    expect(positions(line)).toEqual([
      ["plan", 0, 0],
      ["tests", 308, 0],
      ["publish", 616, 0],
    ]);
    expect(line.map(({ routes }) => routes)).toEqual([
      [{ to: "tests", condition: null, limit: null }],
      [{ to: "publish", condition: null, limit: null }],
      [{ to: null, condition: null, limit: null }],
    ]);
    expect(isConvertedFlow(line)).toBe(true);
  });

  it("keeps the positions and routes Stages have, the rest beside the Stage before them", () => {
    const flow = asFlow([
      { ...plan, position: { x: 40, y: 96 }, routes: [{ to: "review", condition: changed }] },
      review,
    ]);
    // Plan lists its route, so it is 82 + 22 tall: Review stands right of it, level with it.
    expect(positions(flow)).toEqual([
      ["plan", 40, 96],
      ["review", 348, 96],
    ]);
    expect(flow[0]?.routes).toEqual([{ to: "review", condition: changed }]);
    expect(flow[1]?.routes).toEqual([{ to: null, condition: null, limit: null }]);
    expect(isConvertedFlow(flow)).toBe(false);
  });

  it("moves a Stage without a position down until it covers no card", () => {
    const flow = asFlow([
      { ...plan, position: { x: 0, y: 0 } },
      { ...review, position: { x: 308, y: 0 } },
      tests,
    ]);
    // 76 right of Review nothing stands: it keeps Review's y.
    expect(positions(flow).at(-1)).toEqual(["tests", 616, 0]);
    const blocked = asFlow([
      { ...plan, position: { x: 0, y: 0 } },
      tests,
      { ...review, position: { x: 308, y: 0 } },
    ]);
    // 76 right of Plan Review stands, so Tests goes down 16 at a time until it is clear of it.
    expect(positions(blocked)[1]).toEqual(["tests", 308, 80]);
  });

  it("converts a list from before positions by its places, in their order", () => {
    const flow = asFlow([
      { ...plan, place: { column: 0, row: 0 }, routes: [{ to: "tests", condition: null }] },
      {
        ...publish,
        place: { column: 2, row: 0 },
        routes: [
          { to: "review", condition: changed },
          { to: null, condition: null },
        ],
      },
      { ...tests, place: { column: 1, row: 0 }, routes: [{ to: "publish", condition: null }] },
      { ...review, place: { column: 2, row: 1 }, routes: [{ to: null, condition: null }] },
    ]);
    expect(keys(flow)).toEqual(["plan", "tests", "publish", "review"]);
    // Row 0 is as tall as Publish, which lists its 2 routes (82 + 2 × 22), then a gap of 22.
    expect(positions(flow)).toEqual([
      ["plan", 0, 0],
      ["tests", 308, 0],
      ["publish", 616, 0],
      ["review", 616, 148],
    ]);
  });

  it("isn't the converted line once a Stage stands on another row", () => {
    expect(isConvertedFlow(withStagePositioned(line, "tests", { x: 308, y: 120 }))).toBe(false);
  });

  it("is the moved line with the conflict chain drawn in under its Publish", () => {
    const resolve: Stage = {
      kind: "agent",
      key: "office:resolve",
      name: "Resolve",
      optional: false,
      role: "developer",
      brief: "",
      session: "fresh",
      budget: 620_000,
      mergeBaseFirst: true,
      position: { x: 308, y: 148 },
      routes: [{ to: "office:resolve-test", condition: null, limit: null }],
    };
    const resolveTest: Stage = {
      kind: "script",
      key: "office:resolve-test",
      name: "Test after Resolve",
      optional: false,
      command: "test",
      position: { x: 616, y: 148 },
      routes: [
        { to: "office:resolve", condition: FAILED_CONDITION, limit: 2 },
        { to: "publish", condition: null, limit: null },
      ],
    };
    const moved = [
      { ...plan, position: { x: 0, y: 0 }, routes: [{ to: "tests", condition: null }] },
      { ...tests, position: { x: 616, y: 0 }, routes: [{ to: "publish", condition: null }] },
      {
        ...publish,
        position: { x: 924, y: 0 },
        routes: [
          { to: "office:resolve", condition: endsCondition(["conflict"]), limit: 3 },
          { to: null, condition: null, limit: null },
        ],
      },
      resolve,
      resolveTest,
    ];
    expect(isConvertedFlow(moved)).toBe(true);
  });

  it("says which Stages come later by the order, wherever they stand", () => {
    const flow = withStagePositioned(line, "publish", { x: -400, y: 200 });
    expect(laterStages(flow, "plan").map(({ key }) => key)).toEqual(["tests", "publish"]);
    expect(laterStages(flow, "publish")).toEqual([]);
  });

  it("says a route leads back by the order alone, never by where Stages stand", () => {
    const flow = withStagePositioned(line, "publish", { x: -400, y: 200 });
    expect(isRouteBack(flow, "tests", "tests")).toBe(true);
    expect(isRouteBack(flow, "tests", "plan")).toBe(true);
    expect(isRouteBack(flow, "tests", "publish")).toBe(false);
    expect(isRouteBack(flow, "publish", "tests")).toBe(true);
    expect(isRouteBack(flow, "publish", null)).toBe(false);
  });
});

describe("adding a Stage", () => {
  it("puts it unconnected right after the picked Stage in the order, beside it on the canvas", () => {
    const added = withStageAdded(line, gate, "plan");
    expect(added.key).toBe("gate");
    expect(keys(added.stages)).toEqual(["plan", "gate", "tests", "publish"]);
    // 76 right of Plan stands Tests, so it goes down 16 at a time until it covers no card.
    expect(positions(added.stages)[1]).toEqual(["gate", 308, 80]);
    expect(routesOf(added.stages, "gate")).toEqual([]);
    expect(positions(added.stages).filter(([key]) => key !== "gate")).toEqual(positions(line));
  });

  it("puts it last, beside the last Stage, when none is picked, its name and key its own", () => {
    const added = withStageAdded(line, { ...plan }, undefined);
    expect(added.key).toBe("plan-2");
    expect(added.stages.at(-1)).toMatchObject({ name: "Plan 2", position: { x: 924, y: 0 } });
  });
});

describe("moving a Stage", () => {
  it("on the canvas changes its position alone, never the order or a route", () => {
    const back = withRouteDrawn(line, "publish", "plan").stages;
    const moved = withStagePositioned(back, "publish", { x: -300, y: 40 });
    expect(keys(moved)).toEqual(keys(back));
    expect(positions(moved).at(-1)).toEqual(["publish", -300, 40]);
    expect(routesOf(moved, "publish")).toEqual(routesOf(back, "publish"));
    expect(isRouteBack(moved, "publish", "plan")).toBe(true);
  });

  it("earlier and later swaps it in the order, keeping every position", () => {
    const moved = withStageMoved(line, "tests", "earlier");
    expect(keys(moved)).toEqual(["tests", "plan", "publish"]);
    expect(positions(moved).toSorted()).toEqual(positions(line).toSorted());
    expect(keys(withStageMoved(line, "tests", "later"))).toEqual(["plan", "publish", "tests"]);
    expect(canMoveStage(line, "plan", "earlier")).toBe(false);
    expect(canMoveStage(line, "plan", "later")).toBe(true);
    expect(canMoveStage(line, "publish", "later")).toBe(false);
    expect(withStageMoved(line, "plan", "earlier")).toBe(line);
  });

  it("steps through the Pipeline's order", () => {
    expect(stepInOrder(line, "tests", -1)).toBe("plan");
    expect(stepInOrder(line, "publish", 1)).toBeUndefined();
  });
});

describe("Auto-align's edit", () => {
  const laid = {
    stages: new Map([
      ["plan", { x: 0, y: 0 }],
      ["tests", { x: 300, y: 10 }],
      ["publish", { x: 600, y: 20 }],
    ]),
    end: { x: 900, y: 30 },
  };

  it("moves every Stage and End, and one Undo puts them back exactly", () => {
    const moved = withStagePositioned(line, "tests", { x: 333, y: -47 });
    const before = positionsOf(moved, { x: 1200, y: 5 });
    const aligned = canvasEdited(moved, { kind: "auto-align", laid, before });
    expect(positions(aligned.stages)).toEqual([
      ["plan", 0, 0],
      ["tests", 300, 10],
      ["publish", 600, 20],
    ]);
    expect(aligned.endPosition).toEqual({ x: 900, y: 30 });
    expect(aligned.undo).toBe(before);
    expect(keys(aligned.stages)).toEqual(keys(moved));

    const undone = canvasEdited(aligned.stages, { kind: "undo-auto-align", before });
    expect(undone.stages).toEqual(moved);
    expect(undone.endPosition).toEqual({ x: 1200, y: 5 });
    expect(undone.hint).toBe("The Stages are back where they were before Auto-align.");
    expect(undone.undo).toBeUndefined();
  });

  it("puts back an End that stood where it was derived", () => {
    const before = positionsOf(line, undefined);
    const aligned = canvasEdited(line, { kind: "auto-align", laid, before });
    const undone = canvasEdited(aligned.stages, { kind: "undo-auto-align", before });
    expect("endPosition" in undone && undone.endPosition).toBeUndefined();
    expect(withPositions(aligned.stages, before)).toEqual(line);
  });
});

describe("drawing a route", () => {
  it("goes in before the route with no condition, its condition still to set", () => {
    const drawn = withRouteDrawn(line, "plan", "publish");
    expect(drawn.routeIndex).toBe(0);
    expect(routesOf(drawn.stages, "plan")).toEqual([
      { to: "publish", condition: { combine: "all", tests: [] }, limit: null },
      { to: "tests", condition: null, limit: null },
    ]);
  });

  it("picks the route already leading there", () => {
    const drawn = withRouteDrawn(line, "plan", "tests");
    expect(drawn).toEqual({ stages: line, routeIndex: 0 });
  });

  it("needs no condition as a Stage's first route, and draws a route back at most 3 times", () => {
    const added = withStageAdded(line, gate, "tests");
    expect(
      withRouteDrawn(added.stages, "gate", null).stages.find(({ key }) => key === "gate"),
    ).toMatchObject({ routes: [{ to: null, condition: null, limit: null }] });
    expect(routesOf(withRouteDrawn(line, "publish", "plan").stages, "publish")).toEqual([
      { to: "plan", condition: { combine: "all", tests: [] }, limit: 3 },
      { to: null, condition: null, limit: null },
    ]);
    // To its own Stage too.
    expect(routesOf(withRouteDrawn(line, "tests", "tests").stages, "tests")?.[0]).toEqual({
      to: "tests",
      condition: { combine: "all", tests: [] },
      limit: 3,
    });
  });
});

describe("adding a route by its form", () => {
  const agent: Stage = {
    kind: "agent",
    key: "implement",
    name: "Implement",
    optional: false,
    brief: "",
    session: "fresh",
    budget: 1000,
  };
  const flow = asFlow([agent, plan]);

  it("offers When it fails on an Agent Stage, and Otherwise, only while it has none", () => {
    expect(formsToAdd(flow[0]!)).toEqual(["chooses", "holds", "fails"]);
    expect(formsToAdd(flow[1]!)).toEqual(["holds"]);
    const failing = withRouteAdded(flow, "implement", "fails").stages;
    expect(formsToAdd(failing[0]!)).toEqual(["chooses", "holds"]);
    expect(formsToAdd(withRouteRemoved(flow, "plan", 0)[1]!)).toEqual(["holds", "otherwise"]);
  });

  it("puts When it fails first, When these hold before Otherwise and Otherwise last", () => {
    const failing = withRouteAdded(flow, "implement", "fails");
    expect(failing.routeIndex).toBe(0);
    expect(routesOf(failing.stages, "implement")).toEqual([
      { to: null, condition: FAILED_CONDITION, limit: null },
      { to: "plan", condition: null, limit: null },
    ]);
    const holding = withRouteAdded(failing.stages, "implement", "holds");
    expect(holding.routeIndex).toBe(1);
    expect(routesOf(holding.stages, "implement")?.[1]).toEqual({
      to: null,
      condition: { combine: "all", tests: [] },
      limit: null,
    });
    const bare = withRouteRemoved(flow, "plan", 0);
    expect(routesOf(withRouteAdded(bare, "plan", "otherwise").stages, "plan")).toEqual([
      { to: null, condition: null, limit: null },
    ]);
  });

  it("adds an Agent's choice with no words yet among the rows the user orders", () => {
    const failing = withRouteAdded(flow, "implement", "fails").stages;
    const choosing = withRouteAdded(failing, "implement", "chooses");
    expect(choosing.routeIndex).toBe(1);
    expect(routesOf(choosing.stages, "implement")?.[1]).toEqual({
      to: null,
      condition: choiceCondition(""),
      limit: null,
    });
    const holding = withRouteAdded(choosing.stages, "implement", "holds").stages;
    const routes = routesOf(holding, "implement") ?? [];
    expect(routes.map((route) => routeFormOf(agent, route))).toEqual([
      "fails",
      "chooses",
      "holds",
      "otherwise",
    ]);
    expect(canMoveRoute(holding, "implement", 1, 1)).toBe(true);
    expect(canMoveRoute(holding, "implement", 1, -1)).toBe(false);
    expect(canMoveRoute(holding, "implement", 2, 1)).toBe(false);
  });

  it("draws a later route from an Agent Stage as a choice with no words yet", () => {
    const drawn = withRouteDrawn(flow, "implement", null);
    expect(drawn.routeIndex).toBe(0);
    expect(routesOf(drawn.stages, "implement")?.[0]).toEqual({
      to: null,
      condition: choiceCondition(""),
      limit: null,
    });
  });

  it("reads a choice row only on an Agent Stage, and only as its route's one test", () => {
    const choosing = { condition: choiceCondition("the review found something to fix") };
    expect(routeFormOf(agent, choosing)).toBe("chooses");
    expect(choiceWordsOf(choosing)).toBe("the review found something to fix");
    expect(routeFormOf(plan, choosing)).toBe("holds");
    const mixed = {
      condition: {
        combine: "all" as const,
        tests: [
          { kind: "choice" as const, words: "fix" },
          { kind: "definitionOfDone" as const, is: "all-met" as const },
        ],
      },
    };
    expect(routeFormOf(agent, mixed)).toBe("holds");
    expect(choiceWordsOf(mixed)).toBeUndefined();
  });

  it("offers a Publish Stage When it ends…, a later route drawn on it taking no result yet", () => {
    const publishing = asFlow([plan, publish]);
    expect(formsToAdd(publishing[1]!)).toEqual(["ends"]);
    const drawn = withRouteDrawn(publishing, "publish", "plan");
    expect(routesOf(drawn.stages, "publish")?.[drawn.routeIndex]).toEqual({
      to: "plan",
      condition: { combine: "all", tests: [] },
      limit: 3,
    });
    expect(routeFormOf(publish, { condition: { combine: "all", tests: [] } })).toBe("ends");
  });

  it("never moves a row above When it fails or below Otherwise", () => {
    const three = withRouteAdded(
      withRouteAdded(flow, "implement", "fails").stages,
      "implement",
      "holds",
    ).stages;
    expect(canMoveRoute(three, "implement", 1, -1)).toBe(false);
    expect(canMoveRoute(three, "implement", 1, 1)).toBe(false);
    expect(canMoveRoute(three, "implement", 0, 1)).toBe(false);
    const four = withRouteAdded(three, "implement", "holds").stages;
    expect(canMoveRoute(four, "implement", 1, 1)).toBe(true);
  });
});

/** Plan's routes part: to Publish when Plan changed files, otherwise to Tests. */
const two = withRouteCondition(withRouteDrawn(line, "plan", "publish").stages, "plan", 0, changed);

describe("editing routes", () => {
  it("removes a route", () => {
    expect(routesOf(withRouteRemoved(two, "plan", 0), "plan")).toEqual([
      { to: "tests", condition: null, limit: null },
    ]);
  });

  it("reorders routes within their bounds, Otherwise staying last", () => {
    const three = withRouteCondition(withRouteDrawn(two, "plan", null).stages, "plan", 1, changed);
    expect(canMoveRoute(three, "plan", 0, 1)).toBe(true);
    expect(canMoveRoute(three, "plan", 1, 1)).toBe(false);
    expect(canMoveRoute(three, "plan", 2, -1)).toBe(false);
    expect(routesOf(withRouteMoved(three, "plan", 0, 1), "plan")?.map(({ to }) => to)).toEqual([
      null,
      "publish",
      "tests",
    ]);
    const routes = routesOf(two, "plan") ?? [];
    expect(routesMoved(routes, 0, -1)).toBe(routes);
  });

  it("leads a route elsewhere, its saved name gone and its limit kept while it leads the same way", () => {
    const named = withRouteTarget(
      line.with(0, {
        ...plan,
        position: { x: 0, y: 0 },
        routes: [{ to: "tests", toName: "Tests", condition: null, limit: 2 }],
      }),
      "plan",
      0,
      null,
    );
    expect(routesOf(named, "plan")).toEqual([{ to: null, condition: null, limit: 2 }]);
  });

  it("gives a route turned back 3 times, and one turned on No limit", () => {
    const back = withRouteTarget(line, "publish", 0, "plan");
    expect(routesOf(back, "publish")).toEqual([{ to: "plan", condition: null, limit: 3 }]);
    const limited = withRouteLimit(back, "publish", 0, 5);
    expect(routesOf(limited, "publish")).toEqual([{ to: "plan", condition: null, limit: 5 }]);
    expect(routesOf(withRouteTarget(limited, "publish", 0, "tests"), "publish")?.[0]?.limit).toBe(
      5,
    );
    expect(
      routesOf(withRouteTarget(limited, "publish", 0, null), "publish")?.[0]?.limit,
    ).toBeNull();
    expect(routesOf(withRouteLimit(back, "publish", 0, null), "publish")?.[0]?.limit).toBeNull();
  });

  it("keeps every limit as a Stage moves, a route back turning into one on", () => {
    const back = withRouteDrawn(line, "publish", "plan").stages;
    const moved = withStageMoved(back, "publish", "earlier");
    expect(routesOf(moved, "publish")).toEqual(routesOf(back, "publish"));
    expect(isRouteBack(moved, "publish", "tests")).toBe(false);
  });
});

describe("a Stage on a route", () => {
  it("takes the route, its condition kept, and leads on where it led", () => {
    const added = withStageOnRoute(two, "plan", 0, gate);
    expect(added.key).toBe("gate");
    expect(keys(added.stages)).toEqual(["plan", "gate", "tests", "publish"]);
    // Plan lists its two routes (82 + 2 × 22 tall); beside it Tests stands, so it goes down.
    expect(positions(added.stages)[1]).toEqual(["gate", 308, 80]);
    expect(routesOf(added.stages, "plan")).toEqual([
      { to: "gate", condition: changed, limit: null },
      { to: "tests", condition: null, limit: null },
    ]);
    expect(routesOf(added.stages, "gate")).toEqual([
      { to: "publish", condition: null, limit: null },
    ]);
  });

  it("on a route back keeps its limit, and leads back from the new Stage at most 3 times", () => {
    const back = withRouteLimit(withRouteDrawn(line, "publish", "tests").stages, "publish", 0, 2);
    const added = withStageOnRoute(back, "publish", 0, gate);
    expect(routesOf(added.stages, "publish")?.[0]).toMatchObject({ to: "gate", limit: 2 });
    expect(routesOf(added.stages, "gate")).toEqual([{ to: "tests", condition: null, limit: 3 }]);
  });

  it("changes nothing on a route that isn't there", () => {
    expect(withStageOnRoute(line, "plan", 3, gate)).toEqual({ stages: line, key: "plan" });
  });
});

describe("removing a Stage", () => {
  it("leads each route into it where its one route out led", () => {
    const removed = withStageRemovedFromFlow(line, "tests");
    expect(routesOf(removed, "plan")).toEqual([{ to: "publish", condition: null, limit: null }]);
    expect(isConvertedFlow(removed)).toBe(true);
  });

  it("drops a route made needless by the one after it", () => {
    const flow = withRouteDrawn(line, "plan", "publish").stages;
    expect(routesOf(withStageRemovedFromFlow(flow, "tests"), "plan")).toEqual([
      { to: "publish", condition: null, limit: null },
    ]);
  });

  it("removes the routes into it when it had several routes out", () => {
    const parting = withRouteCondition(
      withRouteDrawn(line, "tests", null).stages,
      "tests",
      0,
      changed,
    );
    const removed = withStageRemovedFromFlow(parting, "tests");
    expect(routesOf(removed, "plan")).toEqual([]);
    // Nothing else moves.
    expect(positions(removed)).toEqual([
      ["plan", 0, 0],
      ["publish", 616, 0],
    ]);
  });
});

describe("a Task's flow, its started Stages locked", () => {
  const flow = asFlow([plan, tests, review, publish]);
  const started = new Set(["plan", "tests"]);

  it("adds a Stage after the last started one, so the frozen order stays", () => {
    const added = withStageAdded(flow, gate, "plan", started);
    expect(keys(added.stages)).toEqual(["plan", "tests", "gate", "review", "publish"]);
    expect(keys(withStageAdded(flow, gate, "plan").stages)).toEqual([
      "plan",
      "gate",
      "tests",
      "review",
      "publish",
    ]);
  });

  it("puts a Stage on a route after the frozen ones in the order", () => {
    const added = withStageOnRoute(flow, "plan", 0, gate, started);
    expect(keys(added.stages).slice(0, 3)).toEqual(["plan", "tests", "gate"]);
  });

  it("moves no started Stage in the order, nor another into the frozen ones", () => {
    expect(canMoveStage(flow, "tests", "later", started)).toBe(false);
    expect(canMoveStage(flow, "review", "earlier", started)).toBe(false);
    expect(canMoveStage(flow, "review", "later", started)).toBe(true);
    expect(withStageMoved(flow, "plan", "later", started)).toBe(flow);
  });

  it("never locks a started Stage's position", () => {
    const moved = canvasEdited(
      flow,
      { kind: "move-to", key: "plan", position: { x: 32, y: 160 } },
      started,
    );
    expect(positions(moved.stages)[0]).toEqual(["plan", 32, 160]);
  });
});

describe("a Publish Stage's results", () => {
  it("are one test alone as All of, several as Any of, in the order When it ends… lists them", () => {
    expect(endsCondition(["conflict"])).toEqual({
      combine: "all",
      tests: [{ kind: "stage", stage: null, is: "conflict" }],
    });
    expect(endsCondition(["failed", "after-publishing-failed"])).toEqual({
      combine: "any",
      tests: [
        { kind: "stage", stage: null, is: "after-publishing-failed" },
        { kind: "stage", stage: null, is: "failed" },
      ],
    });
  });

  it("are read back from a condition of the route's own Stage's results alone", () => {
    expect(endedResults({ condition: endsCondition(["published", "failed"]) })).toEqual([
      "published",
      "failed",
    ]);
    expect(endedResults({ condition: FAILED_CONDITION })).toEqual(["failed"]);
    expect(
      endedResults({
        condition: { combine: "all", tests: [{ kind: "stage", stage: null, is: "changed" }] },
      }),
    ).toBeUndefined();
    expect(endedResults({ condition: null })).toBeUndefined();
    expect(routeFormOf(publish, { condition: FAILED_CONDITION })).toBe("ends");
    expect(routeFormOf(tests, { condition: endsCondition(["conflict"]) })).toBe("holds");
  });
});
