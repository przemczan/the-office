import type { ConditionGroup, Stage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { addStage, moveStage } from "./stage-edits.ts";
import { addToFlow, isStraightLine, removeFromFlow, straightLine } from "./stage-routes.ts";

const plan: Stage = { kind: "gate", key: "plan", name: "Plan", optional: false };
const review: Stage = { kind: "gate", key: "review", name: "Review", optional: false };
const publish: Stage = {
  kind: "script",
  key: "publish",
  name: "Publish",
  optional: false,
  command: "publish",
};
const unmet: ConditionGroup = {
  combine: "all",
  tests: [{ kind: "definitionOfDone", is: "some-not-met" }],
};

const line = straightLine([plan, review, publish]);
/** Review was optional: it runs only while the Definition of Done is not met. */
const flow: readonly Stage[] = [
  {
    ...plan,
    place: { column: 0, row: 0 },
    routes: [
      { to: "review", condition: unmet },
      { to: "publish", toName: "Publish", condition: null },
    ],
  },
  { ...review, place: { column: 1, row: 0 }, routes: [{ to: "publish", condition: null }] },
  { ...publish, place: { column: 2, row: 0 }, routes: [{ to: null, condition: null }] },
];

const routesOf = (stages: readonly Stage[]) => stages.map(({ key, routes }) => [key, routes]);

describe("a straight line", () => {
  it("gives each Stage its column on row 0 and one route that always holds to the next, the last to End", () => {
    expect(line.map(({ place }) => place)).toEqual([
      { column: 0, row: 0 },
      { column: 1, row: 0 },
      { column: 2, row: 0 },
    ]);
    expect(routesOf(line)).toEqual([
      ["plan", [{ to: "review", condition: null }]],
      ["review", [{ to: "publish", condition: null }]],
      ["publish", [{ to: null, condition: null }]],
    ]);
  });

  it("counts Stages with no routes yet as one, and a route with a condition as none", () => {
    expect(isStraightLine([plan, review, publish])).toBe(true);
    expect(isStraightLine(line)).toBe(true);
    expect(isStraightLine(flow)).toBe(false);
  });

  it("keeps a route already where it leads, its saved name with it", () => {
    const named = line.with(0, {
      ...plan,
      routes: [{ to: "review", toName: "Review", condition: null }],
    });

    expect(straightLine(named)[0]?.routes).toEqual([
      { to: "review", toName: "Review", condition: null },
    ]);
  });

  it("is derived again after an addition, a removal and a move", () => {
    const added = addToFlow(line, addStage(line, "gate", 0));
    expect(routesOf(added.stages)).toEqual([
      ["plan", [{ to: "review", condition: null }]],
      ["review", [{ to: "gate", condition: null }]],
      ["gate", [{ to: "publish", condition: null }]],
      ["publish", [{ to: null, condition: null }]],
    ]);
    expect(added.stages[2]?.place).toEqual({ column: 2, row: 0 });

    expect(routesOf(removeFromFlow(line, 1))).toEqual([
      ["plan", [{ to: "publish", condition: null }]],
      ["publish", [{ to: null, condition: null }]],
    ]);

    const moved = straightLine(moveStage(line, 0, 1, 0));
    expect(moved.map(({ key, place }) => [key, place?.column])).toEqual([
      ["review", 0],
      ["plan", 1],
      ["publish", 2],
    ]);
    expect(moved[0]?.routes).toEqual([{ to: "plan", condition: null }]);
  });
});

describe("a flow that isn't a straight line", () => {
  it("gets an added Stage after the last, every route to End leading to it", () => {
    const added = addToFlow(flow, addStage(flow, "gate", 0));

    expect(added.index).toBe(3);
    expect(added.stages.slice(0, 2)).toEqual(flow.slice(0, 2));
    expect(added.stages[2]?.routes).toEqual([{ to: "gate", condition: null }]);
    expect(added.stages[3]).toMatchObject({
      key: "gate",
      place: { column: 3, row: 0 },
      routes: [{ to: null, condition: null }],
    });
  });

  it("leads the routes into a removed Stage where its route out led, keeping the rest", () => {
    const withGate = addToFlow(flow, addStage(flow, "gate", 0)).stages;
    const removed = removeFromFlow(withGate, 2);

    expect(routesOf(removed)).toEqual([
      [
        "plan",
        [
          { to: "review", condition: unmet },
          { to: "gate", condition: null },
        ],
      ],
      ["review", [{ to: "gate", condition: null }]],
      ["gate", [{ to: null, condition: null }]],
    ]);
    expect(removed[2]?.place).toEqual({ column: 3, row: 0 });
  });

  it("becomes a straight line once the optional Stage's condition goes with it", () => {
    const removed = removeFromFlow(flow, 1);

    expect(routesOf(removed)).toEqual([
      ["plan", [{ to: "publish", toName: "Publish", condition: null }]],
      ["publish", [{ to: null, condition: null }]],
    ]);
    expect(removed.map(({ place }) => place?.column)).toEqual([0, 1]);
  });
});
