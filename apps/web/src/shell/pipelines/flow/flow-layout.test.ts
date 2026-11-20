import type { Stage, StagePlace } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  dropAt,
  endCellOf,
  flowGridSize,
  flowLines,
  flowRoom,
  gridCellOf,
  loopLanes,
  loopPaths,
  type FlowBox,
  type FlowMeasure,
  needsDetour,
  orientationFor,
  routePaths,
} from "./flow-layout.ts";

function gate(key: string, place: StagePlace, routes: Stage["routes"] = []): Stage {
  return { kind: "gate", key, name: key, optional: false, place, routes };
}

function script(key: string, place: StagePlace, routes: Stage["routes"], goBackTo?: string): Stage {
  return {
    kind: "script",
    key,
    name: key,
    optional: false,
    command: "test",
    place,
    routes,
    ...(goBackTo === undefined ? {} : { onFailure: { goBackTo, rounds: 2 } }),
  };
}

const plain = (to: string | null) => ({ to, condition: null });

/** A Stage's box: 100 by 40, its column 140 apart, its row 60 apart. */
function boxAt({ column, row }: StagePlace): FlowBox {
  return { x: column * 140, y: row * 60, width: 100, height: 40 };
}

/** Each Stage's box, and End after the last column. */
function measureOf(
  stages: readonly Stage[],
  rowCentres: Record<string, number[]> = {},
): FlowMeasure {
  const columns = flowGridSize(stages).columns;
  return {
    stages: new Map(
      stages.map((stage) => [
        stage.key,
        {
          box: boxAt(stage.place ?? { column: 0, row: 0 }),
          rowCentres: rowCentres[stage.key] ?? [],
        },
      ]),
    ),
    end: { x: columns * 140, y: 0, width: 60, height: 40 },
  };
}

describe("the canvas's orientation", () => {
  it("runs top to bottom when narrow, across from 560 and before it is laid out", () => {
    expect(orientationFor(390)).toBe("down");
    expect(orientationFor(559)).toBe("down");
    expect(orientationFor(560)).toBe("across");
    expect(orientationFor(900)).toBe("across");
    expect(orientationFor(0)).toBe("across");
  });
});

describe("the grid of places", () => {
  const stages = [
    gate("plan", { column: 0, row: 0 }),
    gate("a", { column: 1, row: 0 }),
    gate("b", { column: 1, row: 1 }),
    gate("publish", { column: 2, row: 0 }),
  ];

  it("has as many columns and rows as the places use, which the columns share", () => {
    expect(flowGridSize(stages)).toEqual({ columns: 3, rows: 2 });
  });

  it("puts a place in its column and row across, and swaps them down", () => {
    expect(gridCellOf({ column: 1, row: 1 }, "across")).toEqual({ gridColumn: "2", gridRow: "2" });
    expect(gridCellOf({ column: 2, row: 0 }, "down")).toEqual({ gridColumn: "1", gridRow: "3" });
  });

  it("stands End after the last column, the whole height of the rows", () => {
    const size = flowGridSize(stages);
    expect(endCellOf(size, "across")).toEqual({ gridColumn: "4", gridRow: "1 / -1" });
    expect(endCellOf(size, "down")).toEqual({ gridColumn: "1 / -1", gridRow: "4" });
  });

  it("gives a Stage with no place yet the column of its index", () => {
    const unplaced: Stage = { kind: "gate", key: "x", name: "X", optional: false };
    expect(flowGridSize([unplaced, { ...unplaced, key: "y" }])).toEqual({ columns: 2, rows: 1 });
  });
});

describe("the routes' lines", () => {
  const tests = script("tests", { column: 0, row: 0 }, [
    { to: "review", condition: { combine: "all", tests: [] } },
    plain("publish"),
  ]);
  const review = gate("review", { column: 1, row: 0 }, [plain("publish")]);
  const publish = gate("publish", { column: 2, row: 0 }, [plain(null)]);
  const stages = [tests, review, publish];

  it("leave a Stage that lists its routes from each route's port, in their order", () => {
    const lines = flowLines(stages, new Set());
    expect(lines.map(({ id, port }) => [id, port])).toEqual([
      ["tests:0", 0],
      ["tests:1", 1],
      ["review:0", undefined],
      ["publish:0", undefined],
    ]);
    const paths = routePaths(stages, lines, measureOf(stages, { tests: [12, 28] }), "across");
    // Leaving Tests' right edge (x 100) at each route line's middle.
    expect(paths[0]?.d.startsWith("M100,12")).toBe(true);
    expect(paths[1]?.d.startsWith("M100,28")).toBe(true);
    // A Stage that lists none leaves from its edge's middle.
    expect(paths[2]?.d.startsWith("M240,20")).toBe(true);
  });

  it("leave from the bottom edge down, spread across it", () => {
    const lines = flowLines(stages, new Set());
    const paths = routePaths(stages, lines, measureOf(stages, { tests: [30, 70] }), "down");
    expect(paths[0]?.d.startsWith("M33.33")).toBe(true);
    expect(paths[0]?.d).toContain(",40");
  });

  it("draw a removed Stage's routes as ghosts no press picks", () => {
    const lines = flowLines(stages, new Set(["review"]));
    expect(lines.find(({ fromKey }) => fromKey === "review")).toMatchObject({
      look: "ghost",
      routeIndex: undefined,
    });
  });

  it("go round a Stage in between, or back, each in a lane of its own", () => {
    const skipping = script("plan", { column: 0, row: 0 }, [plain("publish")]);
    const flow = [skipping, gate("middle", { column: 1, row: 0 }, [plain("publish")]), publish];
    expect(needsDetour(flow, skipping, publish)).toBe(true);
    expect(needsDetour(flow, flow[1]!, publish)).toBe(false);
    expect(needsDetour(flow, publish, skipping)).toBe(true);
    const room = flowRoom(flow, flowLines(flow, new Set()), []);
    expect(room.detours).toBeGreaterThan(0);
  });
});

describe("the On failure loops", () => {
  it("each get a lane, the shortest nearest the Stages, overlapping ones apart", () => {
    const stages = [
      gate("plan", { column: 0, row: 0 }, [plain("implement")]),
      script("implement", { column: 1, row: 0 }, [plain("tests")]),
      script("tests", { column: 2, row: 0 }, [plain("review")], "implement"),
      script("review", { column: 3, row: 0 }, [plain(null)], "implement"),
    ];
    const lanes = loopLanes(stages);
    expect(lanes.map(({ from, lane }) => [from.key, lane])).toEqual([
      ["tests", 0],
      ["review", 1],
    ]);
    const paths = loopPaths(lanes, measureOf(stages), "across");
    expect(paths).toHaveLength(2);
    expect(paths[0]?.lane).toBe(0);
    expect(flowRoom(stages, [], lanes).loops).toBe(2 * 11 + 14);
  });

  it("share a lane when they don't overlap, and skip a loop to a Stage that's gone", () => {
    const stages = [
      gate("a", { column: 0, row: 0 }),
      script("b", { column: 1, row: 0 }, [], "a"),
      script("c", { column: 2, row: 0 }, []),
      script("d", { column: 3, row: 0 }, [], "c"),
      script("e", { column: 4, row: 0 }, [], "gone"),
    ];
    expect(loopLanes(stages).map(({ lane }) => lane)).toEqual([0, 0]);
  });
});

describe("where a dragged Stage drops", () => {
  const tracks = { columns: [100, 100, 60], rows: [40, 40], columnGap: 40, rowGap: 20 };

  it("drops into the cell under it", () => {
    expect(dropAt(tracks, { x: 190, y: 70 }, "across").drop).toEqual({
      column: 1,
      row: 1,
      newColumn: false,
    });
  });

  it("makes a new column near a column's edge, and after the last", () => {
    expect(dropAt(tracks, { x: 145, y: 10 }, "across").drop).toEqual({
      column: 1,
      row: 0,
      newColumn: true,
    });
    expect(dropAt(tracks, { x: 400, y: 10 }, "across").drop).toEqual({
      column: 2,
      row: 0,
      newColumn: true,
    });
  });

  it("reads the columns top to bottom down", () => {
    const down = { columns: [100, 100], rows: [40, 40, 30], columnGap: 20, rowGap: 30 };
    expect(dropAt(down, { x: 150, y: 90 }, "down").drop).toEqual({
      column: 1,
      row: 1,
      newColumn: false,
    });
  });
});
