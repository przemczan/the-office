import type { Stage, StagePlace } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  dropAt,
  endCellOf,
  flowGridSize,
  flowLines,
  flowRoom,
  gridCellOf,
  listsRoutes,
  loopLanes,
  loopPaths,
  markSpot,
  type FlowBox,
  type FlowMeasure,
  needsDetour,
  orientationFor,
  routePaths,
} from "./flow-layout.ts";
import { FAILED_CONDITION } from "./flow-model.ts";

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
    routes: [
      ...(goBackTo === undefined ? [] : [{ to: goBackTo, condition: FAILED_CONDITION, limit: 2 }]),
      ...(routes ?? []),
    ],
  };
}

const plain = (to: string | null) => ({ to, condition: null, limit: null });

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

type Pt = readonly [number, number];

/** Every point of a path's data, in order: its corners' curves keep it orthogonal. */
function pointsOf(d: string): Pt[] {
  return [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m): Pt => [Number(m[1]), Number(m[2])]);
}

const startOf = (d: string): Pt => pointsOf(d)[0]!;
const arrowTip = (arrow: string): Pt => pointsOf(arrow)[0]!;

function pairs<T>(items: readonly T[]): [T, T][] {
  return items.slice(1).map((item, index): [T, T] => [items[index]!, item]);
}

const overlaps = (a: number, b: number, lo: number, hi: number): boolean =>
  Math.max(a, b) > lo && Math.min(a, b) < hi;

/** Whether a level or upright segment runs through a box's inside, not just along its edge. */
function crossesInside([x1, y1]: Pt, [x2, y2]: Pt, box: FlowBox): boolean {
  return (
    overlaps(x1, x2 === x1 ? x1 + 0.001 : x2, box.x, box.x + box.width) &&
    overlaps(y1, y2 === y1 ? y1 + 0.001 : y2, box.y, box.y + box.height)
  );
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
    const lines = flowLines(stages);
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
    const lines = flowLines(stages);
    const paths = routePaths(stages, lines, measureOf(stages, { tests: [30, 70] }), "down");
    expect(paths[0]?.d.startsWith("M33.33")).toBe(true);
    expect(paths[0]?.d).toContain(",40");
  });

  it("go round a Stage in between, or back, each in a lane of its own", () => {
    const skipping = script("plan", { column: 0, row: 0 }, [plain("publish")]);
    const flow = [skipping, gate("middle", { column: 1, row: 0 }, [plain("publish")]), publish];
    expect(needsDetour(flow, skipping, publish)).toBe(true);
    expect(needsDetour(flow, flow[1]!, publish)).toBe(false);
    expect(needsDetour(flow, publish, skipping)).toBe(true);
    const room = flowRoom(flow, flowLines(flow), [], "across");
    expect(room.detours).toBeGreaterThan(0);
  });

  it("leave the routes back to their lanes, and mark a route on with a limit in its middle", () => {
    const limited = gate("review", { column: 1, row: 0 }, [{ ...plain("publish"), limit: 2 }]);
    const back = gate("publish", { column: 2, row: 0 }, [
      { to: "review", condition: null },
      plain(null),
    ]);
    const flow = [tests, limited, back];
    expect(listsRoutes(limited, flow)).toBe(true);
    expect(listsRoutes(review, stages)).toBe(false);
    const lines = flowLines(flow);
    expect(lines.map(({ id, limit }) => [id, limit])).toEqual([
      ["tests:0", null],
      ["tests:1", null],
      ["review:0", 2],
      ["publish:1", null],
    ]);
    const [path] = routePaths(flow, [lines[2]!], measureOf(flow), "across");
    // From Review's right edge (x 240, y 20) into Publish's left (x 280): its middle.
    expect(path?.mark).toEqual({ x: 257, y: 20 });
    // Publish's route back to Review, a route with no limit given, takes the default of 3.
    expect(loopLanes(flow).map(({ from, to, limit }) => [from.key, to.key, limit])).toEqual([
      ["publish", "review", 3],
    ]);
  });
});

describe("the routes back", () => {
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
    // The nearest lane 24 off the cards' tops (y 0), the next 22 further: a mark's height apart.
    expect(paths.map(({ mark }) => mark.y)).toEqual([-24, -46]);
    expect(flowRoom(stages, [], lanes, "across").loops).toBe(24 + 22 + 9);
    expect(flowRoom(stages, [], lanes, "down").loops).toBe(24 + 22 + 20);
  });

  it("enter and leave a Stage they share at points of their own across its top", () => {
    const stages = [
      gate("plan", { column: 0, row: 0 }),
      script("implement", { column: 1, row: 0 }, [], "plan"),
      script("tests", { column: 2, row: 0 }, [], "implement"),
      script("review", { column: 3, row: 0 }, [], "implement"),
    ];
    const paths = loopPaths(loopLanes(stages), measureOf(stages), "across");
    const atImplement = paths.flatMap((path) => [
      ...(path.line.to === "implement" ? [arrowTip(path.arrow)] : []),
      ...(path.line.fromKey === "implement" ? [startOf(path.d)] : []),
    ]);
    expect(atImplement).toHaveLength(3);
    const xs = atImplement.map(([x]) => x);
    expect(new Set(xs).size).toBe(3);
    // Spread across Implement's top edge, x 140 to 240.
    for (const x of xs) expect(x > 140 && x < 240).toBe(true);
    for (const [a, b] of pairs(xs.toSorted((p, q) => p - q))) expect(b - a).toBeGreaterThan(20);
  });

  it("go up the gutter beside a Stage with another above it, never through a card", () => {
    const stages = [
      gate("plan", { column: 0, row: 0 }),
      script("a", { column: 1, row: 0 }, []),
      script("b", { column: 1, row: 1 }, [], "plan"),
      script("c", { column: 2, row: 1 }, [], "b"),
    ];
    const measure = measureOf(stages);
    // Down, the same places laid out as bands: a column's rows side by side.
    const down: FlowMeasure = {
      stages: new Map(
        [...measure.stages].map(([key, { box, rowCentres }]) => [
          key,
          { box: { x: box.y, y: box.x, width: box.height, height: box.width }, rowCentres },
        ]),
      ),
      end: undefined,
    };
    for (const [orientation, laidOut] of [
      ["across", measure],
      ["down", down],
    ] as const) {
      const paths = loopPaths(loopLanes(stages), laidOut, orientation);
      expect(paths).toHaveLength(2);
      const boxes = [...laidOut.stages.values()].map(({ box }) => box);
      for (const path of paths)
        for (const [p, q] of pairs(pointsOf(path.d)))
          for (const box of boxes) expect(crossesInside(p, q, box)).toBe(false);
    }
    // Across, B leaves its left side (x 140) and turns up in the gutter's middle (x 120).
    const across = loopPaths(loopLanes(stages), measure, "across");
    const fromB = pointsOf(across.find(({ line }) => line.fromKey === "b")!.d);
    expect(fromB[0]).toEqual([140, 72]);
    expect(fromB).toContainEqual([120, 72]);
  });

  it("sit their marks clear of the legs that cross their runs", () => {
    const stages = [
      gate("a", { column: 0, row: 0 }),
      script("b", { column: 1, row: 0 }, []),
      script("c", { column: 2, row: 0 }, [], "a"),
      script("d", { column: 3, row: 0 }, [], "b"),
    ];
    const paths = loopPaths(loopLanes(stages), measureOf(stages), "across");
    const low = paths.find(({ line }) => line.fromKey === "c")!;
    const high = paths.find(({ line }) => line.fromKey === "d")!;
    expect(low.lane).toBeLessThan(high.lane);
    // D's line comes down into B at x 190, the middle of C's run from x 50 to 330.
    expect(arrowTip(high.arrow)[0]).toBe(190);
    expect(Math.abs(low.mark.x - 190)).toBeGreaterThanOrEqual(24);
    expect(low.mark.x > 50 && low.mark.x < 330).toBe(true);
  });

  it("keep the marks of loops on lanes side by side apart, down where a mark is wider than a lane", () => {
    const stages = [
      gate("a", { column: 0, row: 0 }),
      script("b", { column: 1, row: 0 }, []),
      script("c", { column: 2, row: 0 }, [], "b"),
      script("d", { column: 3, row: 0 }, [], "a"),
    ];
    // Down, each Stage a wide card under the one before: D's loop round C's, both centred alike.
    const down: FlowMeasure = {
      stages: new Map(
        stages.map((stage, index) => [
          stage.key,
          { box: { x: 0, y: index * 100, width: 300, height: 56 }, rowCentres: [] },
        ]),
      ),
      end: undefined,
    };
    const [inner, outer] = loopPaths(loopLanes(stages), down, "down").map(({ mark }) => mark);
    // A mark is 40 by 18: side by side 22 apart, they must sit a mark's height apart along.
    expect(Math.abs(inner!.x - outer!.x)).toBeLessThan(40);
    expect(Math.abs(inner!.y - outer!.y)).toBeGreaterThanOrEqual(18);
    // Across, lanes are a mark's height apart already, so both keep the middle.
    const across = loopPaths(loopLanes(stages), measureOf(stages), "across");
    expect(across.map(({ mark }) => mark.x)).toEqual([260, 260]);
  });

  it("take the free spot nearest the middle, or the widest stretch when none is free", () => {
    expect(markSpot({ from: 0, to: 200 }, [], 20)).toBe(100);
    expect(markSpot({ from: 0, to: 200 }, [100], 20)).toBe(76);
    expect(markSpot({ from: 0, to: 60 }, [20], 20)).toBe(40);
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

  it("draw a route to its own Stage out of and into its top edge, with its limit", () => {
    const stages = [
      gate("a", { column: 0, row: 0 }, [plain("b")]),
      script("b", { column: 1, row: 0 }, [plain(null)], "b"),
    ];
    const [path] = loopPaths(loopLanes(stages), measureOf(stages), "across");
    expect(path?.line).toMatchObject({ fromKey: "b", to: "b", routeIndex: 0, limit: 2 });
    const [tipX, tipY] = arrowTip(path!.arrow);
    const [startX, startY] = startOf(path!.d);
    // Both ends on B's top edge (x 140 to 240, y 0), the arrow coming down into it.
    expect(startY).toBe(0);
    expect(tipY).toBe(0);
    expect(tipX).toBeLessThan(startX);
    for (const x of [tipX, startX]) expect(x > 140 && x < 240).toBe(true);
    expect(path?.mark.y).toBe(-24);
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
