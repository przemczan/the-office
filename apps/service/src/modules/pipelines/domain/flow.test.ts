import { describe, expect, it } from "vitest";
import {
  asFlow,
  isRouteBack,
  isStraightLine,
  namedFlow,
  proposedEndPosition,
  straightLineFlow,
  withGivenLimits,
  withPlacesForThePreviousRelease,
  withProposedPositions,
  withoutLayout,
  type FlowStage,
  type GridStage,
} from "./flow.js";
import type { Route, StagePlace, StagePosition } from "./route.js";
import type { Stage } from "./stage.js";
import { agentStage, gate, publishStage, scriptStage } from "./stage.fixtures.js";

const WHILE_SOME_NOT_MET: Route["condition"] = {
  combine: "all",
  tests: [{ kind: "definitionOfDone", is: "some-not-met" }],
};

const implement = agentStage();
const tests = scriptStage();
const look = gate({ key: "look", name: "Look" });
const publish = publishStage();

/** The routes and place of each Stage of `stages`, by its key. */
function flowOf(stages: readonly GridStage[]) {
  return stages.map(({ key, routes, place }) => ({ key, routes, place }));
}

/** The routes and position of each Stage of `stages`, by its key. */
function laidOut(stages: readonly FlowStage[]) {
  return stages.map(({ key, routes, position }) => ({ key, routes, position }));
}

describe("straightLineFlow", () => {
  it("draws a plain Pipeline as a line: each Stage in a column of its own, routing to the next, the last to End", () => {
    expect(flowOf(straightLineFlow([implement, tests, publish]))).toEqual([
      {
        key: "implement",
        routes: [{ to: "tests", condition: null, limit: null }],
        place: { column: 0, row: 0 },
      },
      {
        key: "tests",
        routes: [{ to: "publish", condition: null, limit: null }],
        place: { column: 1, row: 0 },
      },
      {
        key: "publish",
        routes: [{ to: null, condition: null, limit: null }],
        place: { column: 2, row: 0 },
      },
    ]);
  });

  it("routes to an optional Stage in the middle while the Definition of Done has some not met, else past it", () => {
    const optionalLook = { ...look, optional: true };

    expect(flowOf(straightLineFlow([implement, optionalLook, publish]))).toEqual([
      {
        key: "implement",
        routes: [
          { to: "look", condition: WHILE_SOME_NOT_MET, limit: null },
          { to: "publish", condition: null, limit: null },
        ],
        place: { column: 0, row: 0 },
      },
      {
        key: "look",
        routes: [{ to: "publish", condition: null, limit: null }],
        place: { column: 1, row: 0 },
      },
      {
        key: "publish",
        routes: [{ to: null, condition: null, limit: null }],
        place: { column: 2, row: 0 },
      },
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
          { to: "tests", condition: WHILE_SOME_NOT_MET, limit: null },
          { to: "publish", condition: null, limit: null },
        ],
      },
      {
        key: "tests",
        routes: [
          { to: "look", condition: WHILE_SOME_NOT_MET, limit: null },
          { to: "publish", condition: null, limit: null },
        ],
      },
      { key: "look", routes: [{ to: "publish", condition: null, limit: null }] },
      { key: "publish", routes: [{ to: null, condition: null, limit: null }] },
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
        { to: "tests", condition: WHILE_SOME_NOT_MET, limit: null },
        { to: null, condition: null, limit: null },
      ],
      [
        { to: "look", condition: WHILE_SOME_NOT_MET, limit: null },
        { to: null, condition: null, limit: null },
      ],
      [{ to: null, condition: null, limit: null }],
    ]);
  });

  it("routes to an optional last Stage while something is unmet, else to End", () => {
    const optionalLook = { ...look, optional: true };

    expect(flowOf(straightLineFlow([implement, optionalLook])).map(({ routes }) => routes)).toEqual(
      [
        [
          { to: "look", condition: WHILE_SOME_NOT_MET, limit: null },
          { to: null, condition: null, limit: null },
        ],
        [{ to: null, condition: null, limit: null }],
      ],
    );
  });

  it("keeps an optional first Stage first, with nothing routing into it, and the next routing as usual", () => {
    const optionalImplement = { ...implement, optional: true };

    const flow = straightLineFlow([optionalImplement, tests, publish]);

    expect(flowOf(flow)).toEqual([
      {
        key: "implement",
        routes: [{ to: "tests", condition: null, limit: null }],
        place: { column: 0, row: 0 },
      },
      {
        key: "tests",
        routes: [{ to: "publish", condition: null, limit: null }],
        place: { column: 1, row: 0 },
      },
      {
        key: "publish",
        routes: [{ to: null, condition: null, limit: null }],
        place: { column: 2, row: 0 },
      },
    ]);
    expect(flow.flatMap(({ routes }) => routes).some(({ to }) => to === "implement")).toBe(false);
  });

  it("keeps the optional setting and every other field of each Stage", () => {
    const optionalLook = { ...look, optional: true };
    const linting = scriptStage({ key: "lint", name: "Lint", command: "lint" });

    const [first, second, third] = straightLineFlow([implement, linting, optionalLook]);

    expect(first).toMatchObject(implement);
    expect(second).toMatchObject(linting);
    expect(third).toMatchObject({ ...optionalLook, optional: true });
  });
});

describe("asFlow", () => {
  it("converts Stages none of which carries routes, standing in a row in the order given", () => {
    expect(asFlow([implement, tests])).toEqual(
      straightLineFlow([implement, tests]).map(({ place: _place, ...stage }, index) => ({
        ...stage,
        position: { x: index * 308, y: 0 },
      })),
    );
  });

  it("keeps Stages that carry their routes and positions as they are, in the order given", () => {
    const branching: FlowStage[] = [
      {
        ...publish,
        routes: [{ to: null, condition: null, limit: null }],
        position: { x: 924, y: 148 },
      },
      {
        ...implement,
        routes: [
          { to: "publish", condition: WHILE_SOME_NOT_MET, limit: null },
          { to: null, condition: null, limit: null },
        ],
        position: { x: -40, y: 0 },
      },
    ];

    expect(asFlow(branching)).toEqual(branching);
  });

  it("gives a Stage missing its routes none, and one missing its position a spot beside the Stage before it", () => {
    const flow = asFlow([
      {
        ...implement,
        routes: [{ to: "tests", condition: null, limit: null }],
        position: { x: 16, y: 32 },
      },
      tests,
    ]);

    expect(laidOut(flow)).toEqual([
      {
        key: "implement",
        routes: [{ to: "tests", condition: null, limit: null }],
        position: { x: 16, y: 32 },
      },
      { key: "tests", routes: [], position: { x: 324, y: 32 } },
    ]);
  });

  it("moves a Stage missing its position down by the grid's step until it covers no card", () => {
    const flow = asFlow([
      { ...implement, routes: [plain("tests")], position: { x: 0, y: 0 } },
      { ...tests, routes: [plain("look")] },
      { ...look, routes: [plain(null)], position: { x: 308, y: 40 } },
    ]);

    // Look is 72 tall from 40, so Tests clears it at 112, the first step of 16 past it.
    expect(flow.map(({ position }) => position)).toEqual([
      { x: 0, y: 0 },
      { x: 308, y: 112 },
      { x: 308, y: 40 },
    ]);
  });

  it("gives the first Stage the origin when it, and only it, has no position", () => {
    const flow = asFlow([
      { ...implement, routes: [plain("tests")] },
      { ...tests, routes: [plain(null)], position: { x: 616, y: 0 } },
    ]);

    expect(flow.map(({ position }) => position)).toEqual([
      { x: 0, y: 0 },
      { x: 616, y: 0 },
    ]);
  });

  it("leaves the old place out of what it reads, as only a save writes it, for the previous release", () => {
    const flow = asFlow([
      {
        ...implement,
        routes: [plain(null)],
        position: { x: 0, y: 0 },
        place: { column: 4, row: 2 },
      },
    ]);

    expect(flow[0]).not.toHaveProperty("place");
  });
});

/** A Script Stage `key` at a place on the old grid, with `routes`. */
function at(key: string, column: number, row: number, routes: Route[] = []): Stage {
  return { ...scriptStage({ key, name: key }), routes, place: { column, row } };
}

describe("a list from before positions", () => {
  it("is ordered by its places, by column, then by row, keeping the order of Stages at one place", () => {
    const flow = asFlow([
      at("c", 2, 0),
      at("b-low", 1, 1),
      at("a", 0, 0),
      at("b-high", 1, 0),
      at("b-low-too", 1, 1),
    ]);

    expect(flow.map(({ key }) => key)).toEqual(["a", "b-high", "b-low", "b-low-too", "c"]);
  });

  it("stands where its places stood: a column 308 apart, each row as tall as its tallest card and 22 below the one above", () => {
    const tested: Route = { to: "a", condition: WHILE_SOME_NOT_MET, limit: 2 };
    const flow = asFlow([
      at("a", 0, 0, [plain("b")]),
      at("b", 1, 0, [tested, plain("c")]),
      at("c", 1, 1, [plain(null)]),
      at("d", 2, 3, [plain(null)]),
    ]);

    // Row 0 is as tall as b, which lists its two routes: 82 + 2 × 22; row 1 is 72; row 2 has
    // no Stage, so only its gap counts.
    expect(flow.map(({ key, position }) => ({ key, position }))).toEqual([
      { key: "a", position: { x: 0, y: 0 } },
      { key: "b", position: { x: 308, y: 0 } },
      { key: "c", position: { x: 308, y: 148 } },
      { key: "d", position: { x: 616, y: 148 + 72 + 22 + 22 } },
    ]);
  });

  it("counts a route kept without a limit as listed when it leads back, as it takes its default 3", () => {
    const flow = asFlow([
      at("a", 0, 0, [plain("b")]),
      at("b", 1, 0, [{ to: "a", condition: null } as Route]),
      at("c", 0, 1, [plain(null)]),
    ]);

    expect(flow.map(({ key, position }) => ({ key, position }))).toEqual([
      { key: "a", position: { x: 0, y: 0 } },
      { key: "c", position: { x: 0, y: 82 + 22 + 22 } },
      { key: "b", position: { x: 308, y: 0 } },
    ]);
  });

  it("leads back by the same routes as the old order did", () => {
    const flow = asFlow([
      at("tests", 1, 0, [{ to: "implement", condition: null, limit: 3 }, plain("look")]),
      at("look", 1, 1, [plain(null)]),
      at("implement", 0, 0, [plain("tests")]),
    ]);

    expect(isRouteBack(flow, "tests", "implement")).toBe(true);
    expect(isRouteBack(flow, "tests", "look")).toBe(false);
    expect(isRouteBack(flow, "implement", "tests")).toBe(false);
  });

  it("reads the same order after a rollback saved it with places alone", () => {
    const saved = withPlacesForThePreviousRelease(
      asFlow([
        { ...look, routes: [plain(null)], position: { x: 400, y: 300 } },
        { ...implement, routes: [plain("look")], position: { x: 0, y: 900 } },
      ]),
    );
    // The previous release reads only places and drops the positions as it saves.
    const rolledBack = saved.map(({ position: _position, ...stage }) => stage);

    expect(asFlow(rolledBack).map(({ key, position }) => ({ key, position }))).toEqual([
      { key: "look", position: { x: 0, y: 0 } },
      { key: "implement", position: { x: 308, y: 0 } },
    ]);
    expect(isRouteBack(asFlow(rolledBack), "implement", "look")).toBe(true);
  });
});

describe("withPlacesForThePreviousRelease", () => {
  it("gives each Stage the place of its index on row 0, beside its position", () => {
    const flow = asFlow([
      { ...tests, routes: [plain(null)], position: { x: 500, y: 0 } },
      { ...implement, routes: [plain("tests")], position: { x: 0, y: 200 } },
    ]);

    expect(
      withPlacesForThePreviousRelease(flow).map(({ key, position, place }) => ({
        key,
        position,
        place,
      })),
    ).toEqual([
      { key: "tests", position: { x: 500, y: 0 }, place: { column: 0, row: 0 } },
      { key: "implement", position: { x: 0, y: 200 }, place: { column: 1, row: 0 } },
    ]);
  });
});

describe("moving a Stage on the canvas", () => {
  const flow = asFlow([
    { ...implement, routes: [{ to: "tests", condition: null }] },
    { ...tests, routes: [{ to: "implement", condition: WHILE_SOME_NOT_MET }, plain(null)] },
  ] as Stage[]);
  const moved = flow.map((stage) =>
    stage.key === "implement" ? { ...stage, position: { x: 2000, y: -600 } } : stage,
  );

  it("changes neither which routes lead back nor the first Stage", () => {
    expect(isRouteBack(moved, "tests", "implement")).toBe(true);
    expect(isRouteBack(moved, "implement", "tests")).toBe(false);
    expect(asFlow(moved)[0]?.key).toBe("implement");
  });

  it("changes no route's default limit", () => {
    const given = moved.map(({ routes, ...stage }) => ({
      ...stage,
      routes: routes.map(({ limit: _limit, ...route }) => route),
    }));

    expect(withGivenLimits(given).map(({ routes }) => routes?.map(({ limit }) => limit))).toEqual(
      flow.map(({ routes }) => routes.map(({ limit }) => limit)),
    );
  });

  it("is layout alone, which `withoutLayout` leaves out", () => {
    expect(moved.map(withoutLayout)).toEqual(flow.map(withoutLayout));
  });
});

describe("a route's limit", () => {
  const unlimited = { ...implement, routes: [{ to: "tests", condition: null }] };

  it("is set where a route is given without one: 3 back, to its own Stage or before it, No limit on", () => {
    const flow = asFlow([
      { ...implement, routes: [{ to: "tests", condition: null }] },
      {
        ...tests,
        routes: [
          { to: "implement", condition: WHILE_SOME_NOT_MET },
          { to: "tests", condition: WHILE_SOME_NOT_MET },
          { to: null, condition: null },
        ],
      },
    ] as Stage[]);

    expect(flow.map(({ routes }) => routes.map(({ limit }) => limit))).toEqual([
      [null],
      [3, 3, null],
    ]);
  });

  it("is kept where a route is given with one", () => {
    const given: FlowStage = {
      ...tests,
      routes: [{ to: "tests", condition: WHILE_SOME_NOT_MET, limit: 7 }, plain(null)],
      position: { x: 0, y: 0 },
    };

    expect(asFlow([given])).toEqual([given]);
  });

  it("is set by the order of the Stages an edit gives", () => {
    const stages = withGivenLimits([
      { ...tests, routes: [{ to: "implement", condition: null }] },
      unlimited,
    ]);

    expect(stages.map(({ routes }) => routes?.map(({ limit }) => limit))).toEqual([[null], [3]]);
    expect(withGivenLimits([unlimited, tests])[0]?.routes).toEqual([plain("tests")]);
  });

  it("says which routes lead back: to the Stage's own or one before it in the order, never End", () => {
    const flow = asFlow([implement, tests]);

    expect(isRouteBack(flow, "tests", "implement")).toBe(true);
    expect(isRouteBack(flow, "tests", "tests")).toBe(true);
    expect(isRouteBack(flow, "implement", "tests")).toBe(false);
    expect(isRouteBack(flow, "tests", null)).toBe(false);
  });
});

/** A route with no condition and No limit. */
function plain(to: string | null): Route {
  return { to, condition: null, limit: null };
}

describe("namedFlow", () => {
  it("stands the Stages an agent left without positions in a row in the order given, each route naming its Stages", () => {
    const changed: Route["condition"] = {
      combine: "any",
      tests: [
        { kind: "stage", stage: "tests", is: "changed" },
        ...(WHILE_SOME_NOT_MET?.tests ?? []),
      ],
    };
    const named = namedFlow([
      { ...implement, routes: [{ to: "tests", condition: null, limit: null }] },
      {
        ...tests,
        routes: [
          { to: "look", condition: changed, limit: null },
          { to: null, condition: null, limit: null },
        ],
      },
      { ...look, routes: [{ to: null, toName: "Old", condition: null, limit: null }] },
    ]);

    expect(laidOut(named)).toEqual([
      {
        key: "implement",
        routes: [{ to: "tests", toName: "Tests", condition: null, limit: null }],
        position: { x: 0, y: 0 },
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
            limit: null,
          },
          { to: null, condition: null, limit: null },
        ],
        position: { x: 308, y: 0 },
      },
      {
        key: "look",
        routes: [{ to: null, condition: null, limit: null }],
        position: { x: 616, y: 0 },
      },
    ]);
  });

  it("keeps the order given wherever its Stages stand, and draws a plain list as its straight line", () => {
    const named = namedFlow([
      { ...tests, routes: [plain(null)], position: { x: 0, y: 0 } },
      { ...implement, routes: [plain("tests")], position: { x: 900, y: 0 } },
    ]);

    expect(named.map(({ key }) => key)).toEqual(["tests", "implement"]);
    expect(laidOut(namedFlow([implement, tests])).map(({ routes }) => routes)).toEqual([
      [{ to: "tests", toName: "Tests", condition: null, limit: null }],
      [{ to: null, condition: null, limit: null }],
    ]);
  });
});

/** `stage` with one route to End, standing at `x`, `y`. */
function standing(stage: Stage, x: number, y: number): Stage {
  return { ...stage, routes: [plain(null)], position: { x, y } };
}

/** `stage` with one route to End, kept at its old grid `place`. */
function placed(stage: Stage, place: StagePlace): Stage {
  return { ...stage, routes: [plain(null)], place };
}

describe("withProposedPositions", () => {
  it("takes the Proposal's position for a Stage it adds or moves, and keeps where every other stands now", () => {
    const from = [standing(implement, 0, 0), standing(tests, 308, 0), standing(look, 616, 0)];
    // Since the draft, the user moved Tests and Look.
    const now = [standing(implement, 0, 0), standing(tests, 308, 200), standing(look, 616, 400)];
    const to = [
      standing(implement, 0, 0),
      standing(tests, 308, 0),
      standing(look, 1000, 0),
      standing(publish, 1300, 0),
    ];

    expect(
      withProposedPositions(now, from, to).map(({ key, position }) => [key, position]),
    ).toEqual([
      ["implement", { x: 0, y: 0 }],
      ["tests", { x: 308, y: 200 }],
      ["look", { x: 1000, y: 0 }],
      ["publish", { x: 1300, y: 0 }],
    ]);
  });

  it("reads a Proposal kept with places alone as converted", () => {
    const from = [placed(implement, { column: 0, row: 0 }), placed(tests, { column: 1, row: 0 })];
    const now = [standing(implement, 0, 0), standing(tests, 308, 500)];

    expect(withProposedPositions(now, from, from).map(({ position }) => position)).toEqual([
      { x: 0, y: 0 },
      { x: 308, y: 500 },
    ]);
  });
});

describe("proposedEndPosition", () => {
  const now: StagePosition = { x: 900, y: 40 };

  it("takes End where the Proposal moves it, and keeps it where it stands otherwise", () => {
    expect(proposedEndPosition(now, { x: 700, y: 0 }, { x: 1200, y: 0 })).toEqual({
      x: 1200,
      y: 0,
    });
    expect(proposedEndPosition(now, { x: 700, y: 0 }, { x: 700, y: 0 })).toEqual(now);
    expect(proposedEndPosition(now, undefined, undefined)).toEqual(now);
    expect(proposedEndPosition(now, undefined, { x: 10, y: 10 })).toEqual({ x: 10, y: 10 });
  });
});

describe("isStraightLine", () => {
  it("is true of a plain list converted, wherever its Stages stand", () => {
    const line = asFlow([implement, tests, publish]);

    expect(isStraightLine(line)).toBe(true);
    expect(
      isStraightLine(
        line.map((stage, index) => ({ ...stage, position: { x: 0, y: index * 200 } })),
      ),
    ).toBe(true);
  });

  it("is false of a converted optional Stage, a line out of its order, or a route skipping a Stage", () => {
    const line = asFlow([implement, tests, publish]);
    const [first, second, third] = line as [FlowStage, FlowStage, FlowStage];

    expect(isStraightLine(asFlow([implement, { ...tests, optional: true }]))).toBe(false);
    expect(isStraightLine(line.toReversed())).toBe(false);
    expect(
      isStraightLine([
        { ...first, routes: [{ to: "publish", condition: null, limit: null }] },
        second,
        third,
      ]),
    ).toBe(false);
  });
});
