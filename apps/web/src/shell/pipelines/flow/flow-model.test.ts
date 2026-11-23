import type { ConditionGroup, Stage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  asFlow,
  canDropAt,
  canMoveRoute,
  canMoveStage,
  endedResults,
  endsCondition,
  FAILED_CONDITION,
  formsToAdd,
  isRouteBack,
  laterStages,
  routeFormOf,
  routesMoved,
  stepInOrder,
  withRouteAdded,
  withRouteCondition,
  withRouteDrawn,
  withRouteLimit,
  withRouteMoved,
  withRouteRemoved,
  withRouteTarget,
  withStageAdded,
  withStageDropped,
  withStageMoved,
  withStageOnRoute,
  withStageRemovedFromFlow,
} from "./flow-model.ts";
import { isConvertedFlow } from "./converted-flow.ts";

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
const places = (stages: readonly Stage[]) =>
  stages.map(({ key, place }) => [key, place?.column, place?.row]);
const routesOf = (stages: readonly Stage[], key: string) =>
  stages.find((stage) => stage.key === key)?.routes;

describe("a flow", () => {
  it("is given places and straight routes where Stages lack them", () => {
    expect(places(line)).toEqual([
      ["plan", 0, 0],
      ["tests", 1, 0],
      ["publish", 2, 0],
    ]);
    expect(line.map(({ routes }) => routes)).toEqual([
      [{ to: "tests", condition: null, limit: null }],
      [{ to: "publish", condition: null, limit: null }],
      [{ to: null, condition: null, limit: null }],
    ]);
    expect(isConvertedFlow(line)).toBe(true);
  });

  it("keeps the places and routes Stages have, placing the rest after the last column", () => {
    const flow = asFlow([
      { ...plan, place: { column: 0, row: 0 }, routes: [{ to: "review", condition: changed }] },
      review,
    ]);
    expect(places(flow)).toEqual([
      ["plan", 0, 0],
      ["review", 1, 0],
    ]);
    expect(flow[0]?.routes).toEqual([{ to: "review", condition: changed }]);
    expect(flow[1]?.routes).toEqual([{ to: null, condition: null, limit: null }]);
    expect(isConvertedFlow(flow)).toBe(false);
  });

  it("isn't the converted line once a Stage stands on another row", () => {
    expect(isConvertedFlow(withStageMoved(line, "tests", "down"))).toBe(false);
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
      place: { column: 1, row: 1 },
      routes: [{ to: "office:resolve-test", condition: null, limit: null }],
    };
    const resolveTest: Stage = {
      kind: "script",
      key: "office:resolve-test",
      name: "Test after Resolve",
      optional: false,
      command: "test",
      place: { column: 2, row: 1 },
      routes: [
        { to: "office:resolve", condition: FAILED_CONDITION, limit: 2 },
        { to: "publish", condition: null, limit: null },
      ],
    };
    const moved = [
      { ...plan, place: { column: 0, row: 0 }, routes: [{ to: "tests", condition: null }] },
      { ...tests, place: { column: 2, row: 0 }, routes: [{ to: "publish", condition: null }] },
      {
        ...publish,
        place: { column: 3, row: 0 },
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

  it("says which Stages come later by column", () => {
    const flow = withStageDropped(line, "publish", { column: 1, row: 1, newColumn: false });
    expect(laterStages(flow, "plan").map(({ key }) => key)).toEqual(["tests", "publish"]);
    expect(laterStages(flow, "tests")).toEqual([]);
  });

  it("says a route leads back to its own Stage or one before it in the Pipeline's order", () => {
    const flow = withStageDropped(line, "publish", { column: 1, row: 1, newColumn: false });
    expect(isRouteBack(flow, "tests", "tests")).toBe(true);
    expect(isRouteBack(flow, "tests", "plan")).toBe(true);
    // A row below in the same column comes later in the order; one above comes before.
    expect(isRouteBack(flow, "tests", "publish")).toBe(false);
    expect(isRouteBack(flow, "publish", "tests")).toBe(true);
    expect(isRouteBack(flow, "publish", null)).toBe(false);
  });
});

describe("adding a Stage", () => {
  it("puts it unconnected in a column of its own after the picked Stage, a row below", () => {
    const added = withStageAdded(line, gate, "plan");
    expect(added.key).toBe("gate");
    expect(places(added.stages)).toEqual([
      ["plan", 0, 0],
      ["gate", 1, 1],
      ["tests", 2, 0],
      ["publish", 3, 0],
    ]);
    expect(routesOf(added.stages, "gate")).toEqual([]);
  });

  it("puts it after the last column on row 0 when none is picked, its name and key its own", () => {
    const added = withStageAdded(line, { ...plan }, undefined);
    expect(added.key).toBe("plan-2");
    expect(added.stages.at(-1)).toMatchObject({ name: "Plan 2", place: { column: 3, row: 0 } });
  });
});

describe("moving a Stage", () => {
  it("swaps a Stage alone in its column with the neighbouring column", () => {
    const moved = withStageMoved(line, "tests", "earlier");
    expect(places(moved)).toEqual([
      ["tests", 0, 0],
      ["plan", 1, 0],
      ["publish", 2, 0],
    ]);
    expect(canMoveStage(line, "plan", "earlier")).toBe(false);
    expect(canMoveStage(line, "publish", "later")).toBe(false);
    expect(canMoveStage(line, "plan", "up")).toBe(false);
    expect(canMoveStage(line, "plan", "down")).toBe(true);
  });

  it("moves a Stage sharing its column into the neighbouring one, then up past another", () => {
    const shared = withStageDropped(line, "publish", { column: 1, row: 0, newColumn: false });
    expect(places(shared)).toEqual([
      ["plan", 0, 0],
      ["tests", 1, 0],
      ["publish", 1, 1],
    ]);

    const later = withStageMoved(shared, "publish", "later");
    expect(places(later)).toEqual([
      ["plan", 0, 0],
      ["tests", 1, 0],
      ["publish", 2, 1],
    ]);

    const earlier = withStageMoved(shared, "publish", "earlier");
    expect(places(earlier)).toEqual([
      ["plan", 0, 0],
      ["publish", 0, 1],
      ["tests", 1, 0],
    ]);

    const up = withStageMoved(shared, "publish", "up");
    expect(places(up)).toEqual([
      ["plan", 0, 0],
      ["publish", 1, 0],
      ["tests", 1, 1],
    ]);
  });

  it("drops a Stage into a new column, later columns shifting right", () => {
    const dropped = withStageDropped(line, "publish", { column: 1, row: 0, newColumn: true });
    expect(places(dropped)).toEqual([
      ["plan", 0, 0],
      ["publish", 1, 0],
      ["tests", 2, 0],
    ]);
  });

  it("steps through the Pipeline's order", () => {
    expect(stepInOrder(line, "tests", -1)).toBe("plan");
    expect(stepInOrder(line, "publish", 1)).toBeUndefined();
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
    expect(formsToAdd(flow[0]!)).toEqual(["fails", "holds"]);
    expect(formsToAdd(flow[1]!)).toEqual(["holds"]);
    const failing = withRouteAdded(flow, "implement", "fails").stages;
    expect(formsToAdd(failing[0]!)).toEqual(["holds"]);
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
        place: { column: 0, row: 0 },
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
    expect(places(added.stages)).toEqual([
      ["plan", 0, 0],
      ["gate", 1, 0],
      ["tests", 2, 0],
      ["publish", 3, 0],
    ]);
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
    expect(places(removed)).toEqual([
      ["plan", 0, 0],
      ["publish", 1, 0],
    ]);
  });
});

describe("a Task's flow, its started Stages locked", () => {
  const flow = asFlow([plan, tests, review, publish]);
  const started = new Set(["plan", "tests"]);

  it("adds a Stage after a locked one after the frozen columns, so no locked Stage moves", () => {
    const added = withStageAdded(flow, gate, "plan", started);
    expect(places(added.stages)).toEqual([
      ["plan", 0, 0],
      ["tests", 1, 0],
      ["gate", 2, 1],
      ["review", 3, 0],
      ["publish", 4, 0],
    ]);
    expect(places(withStageAdded(flow, gate, "plan").stages)).toContainEqual(["tests", 2, 0]);
  });

  it("puts a Stage on a route into a frozen column after the frozen ones", () => {
    const added = withStageOnRoute(flow, "plan", 0, gate, started);
    expect(places(added.stages).slice(0, 3)).toEqual([
      ["plan", 0, 0],
      ["tests", 1, 0],
      ["gate", 2, 0],
    ]);
  });

  it("never closes up a frozen column when a Stage that hasn't started goes", () => {
    const locked = new Set(["plan", "review"]);
    expect(places(withStageRemovedFromFlow(flow, "tests", locked))).toEqual([
      ["plan", 0, 0],
      ["review", 2, 0],
      ["publish", 3, 0],
    ]);
    expect(places(withStageRemovedFromFlow(flow, "tests"))).toContainEqual(["review", 1, 0]);
  });

  it("offers no drop into a new column among the frozen ones, and moves no locked Stage", () => {
    expect(canDropAt(flow, { column: 1, row: 0, newColumn: true }, started)).toBe(false);
    expect(canDropAt(flow, { column: 2, row: 0, newColumn: true }, started)).toBe(true);
    expect(canDropAt(flow, { column: 1, row: 1, newColumn: false }, started)).toBe(true);
    expect(withStageDropped(flow, "publish", { column: 0, row: 0, newColumn: true }, started)).toBe(
      flow,
    );
    expect(withStageDropped(flow, "tests", { column: 3, row: 1, newColumn: false }, started)).toBe(
      flow,
    );
    expect(canMoveStage(flow, "tests", "later", started)).toBe(false);
    expect(canMoveStage(flow, "review", "earlier", started)).toBe(false);
    expect(canMoveStage(flow, "review", "later", started)).toBe(true);
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
