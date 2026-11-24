import { describe, expect, it } from "vitest";
import {
  edgeRoom,
  routeEdges,
  type EdgeRoute,
  type RouteEdge,
  type TaskBox,
} from "./task-graph-routes.ts";

// Columns as the graph lays them out: 200px Tasks, 44px apart. Column 0's right edge is at 200 and
// column 1's left at 244, so a bend's vertical stands in 212–224, centred on 218.
const COLUMN_STEP = 244;

function box(column: number, top: number, height = 60): TaskBox {
  const left = column * COLUMN_STEP;
  return { left, right: left + 200, top, bottom: top + height, column };
}

function edge(from: string, to: string, more: Partial<RouteEdge> = {}): RouteEdge {
  return { from, to, blockerDone: false, fromOutside: false, ...more };
}

function routed(
  boxes: Record<string, TaskBox>,
  edges: readonly RouteEdge[],
): Map<string, EdgeRoute> {
  return new Map(
    routeEdges(new Map(Object.entries(boxes)), edges).map((route) => [route.key, route]),
  );
}

function routeOf(routes: Map<string, EdgeRoute>, key: string): EdgeRoute {
  const route = routes.get(key);
  if (!route) throw new Error(`No route ${key}`);
  return route;
}

/** The height the line leaves its blocker at. */
function startY(route: EdgeRoute): number {
  return Number(/^M[\d.-]+,([\d.-]+)/.exec(route.line)?.[1]);
}

/** The height of the arrowhead's tip, where the line meets the waiting Task. */
function tipY(route: EdgeRoute): number {
  return Number(/ L[\d.-]+,([\d.-]+) L/.exec(route.head)?.[1]);
}

/** The x of each vertical run, where a first corner ends. */
function verticalXs(route: EdgeRoute): number[] {
  return [...route.line.matchAll(/A[\d.]+,[\d.]+ 0 0 \d ([\d.-]+),[\d.-]+ L\1,/g)].map(([, x]) =>
    Number(x),
  );
}

describe("routeEdges", () => {
  it("runs straight out of the blocker and straight into an 8×8 head whose tip is 2 off the Task", () => {
    const routes = routed({ a: box(0, 0), b: box(1, 100) }, [edge("a", "b")]);
    const route = routeOf(routes, "a>b");
    // 12px straight out before the first corner, 6px corners, the vertical at 218, and 11px of line
    // after the last corner into the head's base at 234, the tip at 242.
    expect(route.line).toBe(
      "M200,30 L212,30 A6,6 0 0 1 218,36 L218,124 A6,6 0 0 0 224,130 L235,130",
    );
    expect(route.head).toBe("M234,126 L242,130 L234,134 Z");
  });

  it("draws ends 8 apart or less as one line, the waiting Task's end moving when it is alone", () => {
    const route = routeOf(routed({ a: box(0, 0), b: box(1, 6) }, [edge("a", "b")]), "a>b");
    expect(route.line).toBe("M200,30 L235,30");
    expect(tipY(route)).toBe(30);
  });

  it("moves the blocker's end instead when only it is alone on its side", () => {
    const routes = routed({ a: box(0, 0), e: box(0, 300), b: box(1, 10) }, [
      edge("a", "b"),
      edge("e", "b"),
    ]);
    // b's ports: a>b at 36, e>b at 44; a's single port moves from 30 to 36.
    expect(routeOf(routes, "a>b").line).toBe("M200,36 L235,36");
  });

  it("bends ends nearly level when neither is alone on its side", () => {
    const routes = routed({ a: box(0, 0), d: box(0, 72), b: box(1, 4), c: box(1, 200) }, [
      edge("a", "b"),
      edge("a", "c"),
      edge("d", "b"),
    ]);
    const route = routeOf(routes, "a>b");
    expect(startY(route)).toBe(26);
    expect(tipY(route)).toBe(30);
    // Corners half the 4px difference, on one vertical.
    expect(route.line).toContain("A2,2 0 0 1");
    expect(verticalXs(route)).toHaveLength(1);
  });

  it("spreads a Task's ports 8 apart around mid-height, ordered by where each edge heads", () => {
    const routes = routed({ a: box(0, 100), b: box(1, 0), c: box(1, 100), d: box(1, 200) }, [
      edge("a", "d"),
      edge("a", "b"),
      edge("a", "c"),
    ]);
    expect(startY(routeOf(routes, "a>b"))).toBe(122);
    expect(startY(routeOf(routes, "a>c"))).toBe(130);
    expect(startY(routeOf(routes, "a>d"))).toBe(138);
  });

  it("keeps ports 12 inside a short Task's corners", () => {
    const routes = routed({ a: box(0, 100, 30), b: box(1, 0), c: box(1, 200) }, [
      edge("a", "b"),
      edge("a", "c"),
    ]);
    expect(startY(routeOf(routes, "a>b"))).toBe(112);
    expect(startY(routeOf(routes, "a>c"))).toBe(118);
  });

  it("gives each of several edges into one Task its own port and head, without crossing", () => {
    const routes = routed({ a: box(0, 0), b: box(0, 100), e: box(0, 200), c: box(1, 100) }, [
      edge("e", "c"),
      edge("a", "c"),
      edge("b", "c", { blockerDone: true }),
    ]);
    expect(tipY(routeOf(routes, "a>c"))).toBe(122);
    expect(tipY(routeOf(routes, "b>c"))).toBe(130);
    expect(tipY(routeOf(routes, "e>c"))).toBe(138);
    expect(new Set([...routes.values()].map(({ head }) => head)).size).toBe(3);
    expect(routeOf(routes, "b>c")).toMatchObject({ blockerDone: true, line: "M200,130 L235,130" });
    // The rising edge's vertical stands left of the falling one's, 4px apart.
    expect(verticalXs(routeOf(routes, "e>c"))).toEqual([216]);
    expect(verticalXs(routeOf(routes, "a>c"))).toEqual([220]);
  });

  it("stands four bends in one gap 4 apart in its middle 12, the lowest falling one furthest left", () => {
    const boxes = Object.fromEntries(
      [0, 1, 2, 3].flatMap((row) => [
        [`a${row}`, box(0, row * 100)],
        [`b${row}`, box(1, row * 100 + 50)],
      ]),
    );
    const routes = routed(
      boxes,
      [0, 1, 2, 3].map((row) => edge(`a${row}`, `b${row}`)),
    );
    const xs = [0, 1, 2, 3].flatMap((row) => verticalXs(routeOf(routes, `a${row}>b${row}`)));
    expect(xs).toEqual([224, 220, 216, 212]);
  });

  it("keeps its height through a skipped column it misses by 10", () => {
    const routes = routed({ a: box(0, 0), x: box(1, 100), c: box(2, 0) }, [edge("a", "c")]);
    expect(routeOf(routes, "a>c").line).toBe("M200,30 L479,30");
  });

  it("runs 10 above a skipped column when that is shorter, bending in the gaps either side", () => {
    const routes = routed({ a: box(0, 0), x: box(1, 10), c: box(2, 0) }, [edge("a", "c")]);
    const { line } = routeOf(routes, "a>c");
    expect(line).toBe(
      "M200,30 L212,30 A6,6 0 0 0 218,24 L218,6 A6,6 0 0 1 224,0" +
        " L456,0 A6,6 0 0 1 462,6 L462,24 A6,6 0 0 0 468,30 L479,30",
    );
  });

  it("runs 10 below a skipped column when that is shorter", () => {
    const routes = routed({ a: box(0, 0), x: box(1, -10), c: box(2, 0) }, [edge("a", "c")]);
    const { line } = routeOf(routes, "a>c");
    expect(line).toContain("L218,54 A6,6 0 0 0 224,60 L456,60 A6,6 0 0 0 462,54");
  });

  it("never runs between two Tasks of a skipped column", () => {
    const routes = routed({ a: box(0, 36), x: box(1, 0), y: box(1, 72), c: box(2, 36) }, [
      edge("a", "c"),
    ]);
    const lane = /L456,([\d.-]+) /.exec(routeOf(routes, "a>c").line)?.[1];
    expect(Number(lane)).toBe(-10);
  });

  it("stands two lines in one lane 4 apart, the one whose ends lie further out outermost", () => {
    const routes = routed(
      { a: box(0, 0), d: box(0, 72), x: box(1, 0, 300), c: box(2, 0), e: box(2, 72) },
      [edge("d", "e"), edge("a", "c")],
    );
    expect(routeOf(routes, "a>c").line).toMatch(/ L[\d.]+,-14 A/);
    expect(routeOf(routes, "d>e").line).toMatch(/ L[\d.]+,-10 A/);
  });

  it("reports how far up and down a route reaches, its stroke and head included", () => {
    // Above a skipped column: the lane at 0, so the line's stroke reaches 0.75 above it.
    const above = routeOf(
      routed({ a: box(0, 0), x: box(1, 10), c: box(2, 0) }, [edge("a", "c")]),
      "a>c",
    );
    expect(above).toMatchObject({ top: -0.75, bottom: 34 });
    // Below one: the lane at 60, 0.75 more for the stroke; the head reaches 4 either side of 30.
    const below = routeOf(
      routed({ a: box(0, 0), x: box(1, -10), c: box(2, 0) }, [edge("a", "c")]),
      "a>c",
    );
    expect(below).toMatchObject({ top: 26, bottom: 60.75 });
  });

  it("asks for room above and below the Tasks' height for the routes that run outside it", () => {
    const routes = routeEdges(
      new Map([
        ["a", box(0, 0)],
        ["x", box(1, 10)],
        ["c", box(2, 0)],
        ["d", box(0, 100)],
        ["y", box(1, 90)],
        ["e", box(2, 100)],
      ]),
      [edge("a", "c"), edge("d", "e")],
    );
    // a>c runs 10 above x (at 0), d>e 10 below y (at 160); the Tasks span 0 to 160.
    expect(edgeRoom(routes, 160)).toEqual({ above: 1, below: 1 });
    expect(edgeRoom(routes, 200)).toEqual({ above: 1, below: 0 });
    expect(edgeRoom([], 160)).toEqual({ above: 0, below: 0 });
  });

  it("carries what the drawing needs: the edge's key, a Done blocker and one from outside", () => {
    const [route] = routeEdges(
      new Map([
        ["a", box(0, 0)],
        ["b", box(1, 0)],
      ]),
      [edge("a", "b", { blockerDone: true, fromOutside: true }), edge("a", "missing")],
    );
    expect(route).toMatchObject({ key: "a>b", blockerDone: true, fromOutside: true });
  });
});
