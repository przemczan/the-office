import { describe, expect, it } from "vitest";
import {
  asFlow,
  isStraightLine,
  pipelineOrder,
  placedInOrder,
  straightLineFlow,
  type FlowStage,
} from "./flow.js";
import type { Route } from "./route.js";
import { agentStage, gate, scriptStage } from "./stage.fixtures.js";

const WHILE_SOME_NOT_MET: Route["condition"] = {
  combine: "all",
  tests: [{ kind: "definitionOfDone", is: "some-not-met" }],
};

const implement = agentStage();
const tests = scriptStage();
const look = gate({ key: "look", name: "Look" });
const publish = scriptStage({ key: "publish", name: "Publish", command: "publish" });

/** The routes and place of each Stage of `stages`, by its key. */
function flowOf(stages: readonly FlowStage[]) {
  return stages.map(({ key, routes, place }) => ({ key, routes, place }));
}

describe("straightLineFlow", () => {
  it("draws a plain Pipeline as a line: each Stage in a column of its own, routing to the next, the last to End", () => {
    expect(flowOf(straightLineFlow([implement, tests, publish]))).toEqual([
      {
        key: "implement",
        routes: [{ to: "tests", condition: null }],
        place: { column: 0, row: 0 },
      },
      { key: "tests", routes: [{ to: "publish", condition: null }], place: { column: 1, row: 0 } },
      { key: "publish", routes: [{ to: null, condition: null }], place: { column: 2, row: 0 } },
    ]);
  });

  it("routes to an optional Stage in the middle while the Definition of Done has some not met, else past it", () => {
    const optionalLook = { ...look, optional: true };

    expect(flowOf(straightLineFlow([implement, optionalLook, publish]))).toEqual([
      {
        key: "implement",
        routes: [
          { to: "look", condition: WHILE_SOME_NOT_MET },
          { to: "publish", condition: null },
        ],
        place: { column: 0, row: 0 },
      },
      { key: "look", routes: [{ to: "publish", condition: null }], place: { column: 1, row: 0 } },
      { key: "publish", routes: [{ to: null, condition: null }], place: { column: 2, row: 0 } },
    ]);
  });

  it("routes each of consecutive optional Stages to the next one, else to the first that isn't optional", () => {
    const optionalTests = { ...tests, optional: true };
    const optionalLook = { ...look, optional: true };

    expect(
      flowOf(straightLineFlow([implement, optionalTests, optionalLook, publish])).map(
        ({ key, routes }) => ({ key, routes }),
      ),
    ).toEqual([
      {
        key: "implement",
        routes: [
          { to: "tests", condition: WHILE_SOME_NOT_MET },
          { to: "publish", condition: null },
        ],
      },
      {
        key: "tests",
        routes: [
          { to: "look", condition: WHILE_SOME_NOT_MET },
          { to: "publish", condition: null },
        ],
      },
      { key: "look", routes: [{ to: "publish", condition: null }] },
      { key: "publish", routes: [{ to: null, condition: null }] },
    ]);
  });

  it("routes past optional Stages to End when no Stage after them is required", () => {
    const optionalTests = { ...tests, optional: true };
    const optionalLook = { ...look, optional: true };

    expect(
      flowOf(straightLineFlow([implement, optionalTests, optionalLook])).map(
        ({ routes }) => routes,
      ),
    ).toEqual([
      [
        { to: "tests", condition: WHILE_SOME_NOT_MET },
        { to: null, condition: null },
      ],
      [
        { to: "look", condition: WHILE_SOME_NOT_MET },
        { to: null, condition: null },
      ],
      [{ to: null, condition: null }],
    ]);
  });

  it("routes to an optional last Stage while something is unmet, else to End", () => {
    const optionalLook = { ...look, optional: true };

    expect(flowOf(straightLineFlow([implement, optionalLook])).map(({ routes }) => routes)).toEqual(
      [
        [
          { to: "look", condition: WHILE_SOME_NOT_MET },
          { to: null, condition: null },
        ],
        [{ to: null, condition: null }],
      ],
    );
  });

  it("keeps an optional first Stage first, with nothing routing into it, and the next routing as usual", () => {
    const optionalImplement = { ...implement, optional: true };

    const flow = straightLineFlow([optionalImplement, tests, publish]);

    expect(flowOf(flow)).toEqual([
      {
        key: "implement",
        routes: [{ to: "tests", condition: null }],
        place: { column: 0, row: 0 },
      },
      { key: "tests", routes: [{ to: "publish", condition: null }], place: { column: 1, row: 0 } },
      { key: "publish", routes: [{ to: null, condition: null }], place: { column: 2, row: 0 } },
    ]);
    expect(flow.flatMap(({ routes }) => routes).some(({ to }) => to === "implement")).toBe(false);
  });

  it("keeps the optional setting and every other field of each Stage", () => {
    const optionalLook = { ...look, optional: true };
    const looping = scriptStage({ onFailure: { goBackTo: "implement", rounds: 2 } });

    const [first, second, third] = straightLineFlow([implement, looping, optionalLook]);

    expect(first).toMatchObject(implement);
    expect(second).toMatchObject(looping);
    expect(third).toMatchObject({ ...optionalLook, optional: true });
  });
});

describe("asFlow", () => {
  it("converts Stages none of which carries routes", () => {
    expect(asFlow([implement, tests])).toEqual(straightLineFlow([implement, tests]));
  });

  it("keeps Stages that carry their routes as they are", () => {
    const branching: FlowStage[] = [
      {
        ...implement,
        routes: [
          { to: "publish", condition: WHILE_SOME_NOT_MET },
          { to: null, condition: null },
        ],
        place: { column: 0, row: 0 },
      },
      { ...publish, routes: [{ to: null, condition: null }], place: { column: 3, row: 1 } },
    ];

    expect(asFlow(branching)).toEqual(branching);
  });

  it("gives a Stage missing its routes none, and one missing its place its index's column, once another carries routes", () => {
    const flow = asFlow([{ ...implement, routes: [{ to: "tests", condition: null }] }, tests]);

    expect(flowOf(flow)).toEqual([
      {
        key: "implement",
        routes: [{ to: "tests", condition: null }],
        place: { column: 0, row: 0 },
      },
      { key: "tests", routes: [], place: { column: 1, row: 0 } },
    ]);
  });
});

/** A Script Stage `key` at a place, with no routes. */
function at(key: string, column: number, row: number): FlowStage {
  return { ...scriptStage({ key, name: key }), routes: [], place: { column, row } };
}

describe("placedInOrder", () => {
  it("places the Stages an agent left without places one to a column in the order given, each route naming its Stages", () => {
    const changed: Route["condition"] = {
      combine: "any",
      tests: [
        { kind: "stage", stage: "tests", is: "changed" },
        ...(WHILE_SOME_NOT_MET?.tests ?? []),
      ],
    };
    const placed = placedInOrder([
      { ...implement, routes: [{ to: "tests", condition: null }] },
      {
        ...tests,
        routes: [
          { to: "look", condition: changed },
          { to: null, condition: null },
        ],
      },
      { ...look, routes: [{ to: null, toName: "Old", condition: null }] },
    ]);

    expect(flowOf(placed)).toEqual([
      {
        key: "implement",
        routes: [{ to: "tests", toName: "Tests", condition: null }],
        place: { column: 0, row: 0 },
      },
      {
        key: "tests",
        routes: [
          {
            to: "look",
            toName: "Look",
            condition: {
              combine: "any",
              tests: [
                { kind: "stage", stage: "tests", stageName: "Tests", is: "changed" },
                { kind: "definitionOfDone", is: "some-not-met" },
              ],
            },
          },
          { to: null, condition: null },
        ],
        place: { column: 1, row: 0 },
      },
      { key: "look", routes: [{ to: null, condition: null }], place: { column: 2, row: 0 } },
    ]);
  });

  it("orders Stages by the places given, and draws a plain list as its straight line", () => {
    const placed = placedInOrder([
      { ...tests, routes: [{ to: null, condition: null }], place: { column: 1, row: 0 } },
      { ...implement, routes: [{ to: "tests", condition: null }], place: { column: 0, row: 0 } },
    ]);

    expect(placed.map(({ key }) => key)).toEqual(["implement", "tests"]);
    expect(flowOf(placedInOrder([implement, tests])).map(({ routes }) => routes)).toEqual([
      [{ to: "tests", toName: "Tests", condition: null }],
      [{ to: null, condition: null }],
    ]);
  });
});

describe("pipelineOrder", () => {
  it("orders Stages by column, then by row, keeping the order of Stages at one place", () => {
    const ordered = pipelineOrder([
      at("c", 2, 0),
      at("b-low", 1, 1),
      at("a", 0, 0),
      at("b-high", 1, 0),
      at("b-low-too", 1, 1),
    ]);

    expect(ordered.map(({ key }) => key)).toEqual(["a", "b-high", "b-low", "b-low-too", "c"]);
  });
});

describe("isStraightLine", () => {
  it("is true of a plain list converted, in any order it comes in", () => {
    const line = straightLineFlow([implement, tests, publish]);

    expect(isStraightLine(line)).toBe(true);
    expect(isStraightLine(line.toReversed())).toBe(true);
  });

  it("is false of a converted optional Stage, a Stage off row 0, a gap in the columns, or a route skipping a Stage", () => {
    const line = straightLineFlow([implement, tests, publish]);
    const [first, second, third] = line as [FlowStage, FlowStage, FlowStage];

    expect(isStraightLine(straightLineFlow([implement, { ...tests, optional: true }]))).toBe(false);
    expect(isStraightLine([first, { ...second, place: { column: 1, row: 1 } }, third])).toBe(false);
    expect(isStraightLine([first, second, { ...third, place: { column: 3, row: 0 } }])).toBe(false);
    expect(
      isStraightLine([{ ...first, routes: [{ to: "publish", condition: null }] }, second, third]),
    ).toBe(false);
  });
});
