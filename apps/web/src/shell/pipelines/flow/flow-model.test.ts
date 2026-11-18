import type { ConditionGroup, Stage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  asFlow,
  canDropAt,
  canMoveRoute,
  canMoveStage,
  earlierStages,
  flowFailureTargets,
  laterStages,
  routesMoved,
  stepInOrder,
  withRouteCondition,
  withRouteDrawn,
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
  onFailure: { goBackTo: "plan", rounds: 3 },
};
const review: Stage = { kind: "gate", key: "review", name: "Review", optional: false };
const publish: Stage = {
  kind: "script",
  key: "publish",
  name: "Publish",
  optional: false,
  command: "publish",
  onFailure: { goBackTo: "tests", rounds: 2 },
};
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
      [{ to: "tests", condition: null }],
      [{ to: "publish", condition: null }],
      [{ to: null, condition: null }],
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
    expect(flow[1]?.routes).toEqual([{ to: null, condition: null }]);
    expect(isConvertedFlow(flow)).toBe(false);
  });

  it("isn't the converted line once a Stage stands on another row", () => {
    expect(isConvertedFlow(withStageMoved(line, "tests", "down"))).toBe(false);
  });

  it("says which Stages come earlier and later by column, and where a failure may go back", () => {
    const flow = withStageDropped(line, "publish", { column: 1, row: 1, newColumn: false });
    expect(earlierStages(flow, "tests").map(({ key }) => key)).toEqual(["plan"]);
    expect(laterStages(flow, "plan").map(({ key }) => key)).toEqual(["tests", "publish"]);
    expect(laterStages(flow, "tests")).toEqual([]);
    expect(flowFailureTargets(line, "publish").map(({ key }) => key)).toEqual(["tests"]);
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
      { to: "publish", condition: { combine: "all", tests: [] } },
      { to: "tests", condition: null },
    ]);
  });

  it("picks the route already leading there", () => {
    const drawn = withRouteDrawn(line, "plan", "tests");
    expect(drawn).toEqual({ stages: line, routeIndex: 0 });
  });

  it("needs no condition as a Stage's first route, and draws one leading back too", () => {
    const added = withStageAdded(line, gate, "tests");
    expect(
      withRouteDrawn(added.stages, "gate", null).stages.find(({ key }) => key === "gate"),
    ).toMatchObject({ routes: [{ to: null, condition: null }] });
    expect(routesOf(withRouteDrawn(line, "publish", "plan").stages, "publish")).toEqual([
      { to: "plan", condition: { combine: "all", tests: [] } },
      { to: null, condition: null },
    ]);
  });
});

/** Plan's routes part: to Publish when Plan changed files, otherwise to Tests. */
const two = withRouteCondition(withRouteDrawn(line, "plan", "publish").stages, "plan", 0, changed);

describe("editing routes", () => {
  it("removes a route", () => {
    expect(routesOf(withRouteRemoved(two, "plan", 0), "plan")).toEqual([
      { to: "tests", condition: null },
    ]);
  });

  it("reorders routes within their bounds", () => {
    expect(canMoveRoute(two, "plan", 0, 1)).toBe(true);
    expect(canMoveRoute(two, "plan", 1, 1)).toBe(false);
    expect(routesOf(withRouteMoved(two, "plan", 0, 1), "plan")).toEqual([
      { to: "tests", condition: null },
      { to: "publish", condition: changed },
    ]);
    const routes = routesOf(two, "plan") ?? [];
    expect(routesMoved(routes, 0, -1)).toBe(routes);
  });

  it("leads a route elsewhere, its saved name gone", () => {
    const named = withRouteTarget(
      line.with(0, {
        ...plan,
        place: { column: 0, row: 0 },
        routes: [{ to: "tests", toName: "Tests", condition: null }],
      }),
      "plan",
      0,
      null,
    );
    expect(routesOf(named, "plan")).toEqual([{ to: null, condition: null }]);
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
      { to: "gate", condition: changed },
      { to: "tests", condition: null },
    ]);
    expect(routesOf(added.stages, "gate")).toEqual([{ to: "publish", condition: null }]);
  });

  it("changes nothing on a route that isn't there", () => {
    expect(withStageOnRoute(line, "plan", 3, gate)).toEqual({ stages: line, key: "plan" });
  });
});

describe("removing a Stage", () => {
  it("leads each route into it where its one route out led, and clears loops back to it", () => {
    const removed = withStageRemovedFromFlow(line, "tests");
    expect(routesOf(removed, "plan")).toEqual([{ to: "publish", condition: null }]);
    expect(removed.find(({ key }) => key === "publish")).toMatchObject({ onFailure: undefined });
    expect(isConvertedFlow(removed)).toBe(true);
  });

  it("drops a route made needless by the one after it", () => {
    const flow = withRouteDrawn(line, "plan", "publish").stages;
    expect(routesOf(withStageRemovedFromFlow(flow, "tests"), "plan")).toEqual([
      { to: "publish", condition: null },
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
