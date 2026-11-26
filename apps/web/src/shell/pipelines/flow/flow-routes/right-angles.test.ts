import { describe, expect, it } from "vitest";
import type { FlowOrientation } from "../flow-layout.ts";
import { rightAngles } from "./right-angles.ts";
import type { DrawnRoute, RouteScene } from "./route-drawer.ts";
import { FIXTURE_NAMES, fixtureScene, gridScene } from "./route-fixtures.ts";
import { lineHitsBox, type Pt } from "./route-geometry.ts";

/**
 * What only Right angles keeps (docs/design/pipeline-route-drawing.html, "Tests"): no two lines
 * share a stretch, and a drag of a large Pipeline draws within the frame's budget.
 */

const ORIENTATIONS: readonly FlowOrientation[] = ["across", "down"];
const EDGE = 0.01;
/** Drawing the routes takes at most this much of a frame while a Stage is dragged. */
const BUDGET_MS = 4;
/** A busy test run, with other files' tests beside it, may take this many times longer. */
const BUSY_RUN = 3;

const pointsOf = (route: DrawnRoute): readonly Pt[] => route.points.map(({ x, y }): Pt => [x, y]);

/** How long the two stretches run along each other, on one level or one upright. */
function sharedLength(a: Pt, b: Pt, c: Pt, d: Pt): number {
  for (const along of [0, 1] as const) {
    const across = along === 0 ? 1 : 0;
    const straight = (p: Pt, q: Pt): boolean => Math.abs(p[across] - q[across]) <= EDGE;
    if (!straight(a, b) || !straight(c, d) || Math.abs(a[across] - c[across]) > EDGE) continue;
    const low = Math.max(Math.min(a[along], b[along]), Math.min(c[along], d[along]));
    const high = Math.min(Math.max(a[along], b[along]), Math.max(c[along], d[along]));
    if (high - low > EDGE) return high - low;
  }
  return 0;
}

function sharedStretches(one: readonly Pt[], other: readonly Pt[]): number {
  let shared = 0;
  for (let i = 1; i < one.length; i += 1)
    for (let j = 1; j < other.length; j += 1)
      shared += sharedLength(one[i - 1]!, one[i]!, other[j - 1]!, other[j]!);
  return shared;
}

describe.each(FIXTURE_NAMES.flatMap((fixture) => ORIENTATIONS.map((o) => [fixture, o] as const)))(
  "Right angles on %s %s",
  (fixture, orientation) => {
    const { routes } = rightAngles(fixtureScene(fixture, orientation));

    it("lets no two lines run along one stretch", () => {
      const sharing = routes.flatMap((route, index) =>
        routes
          .slice(index + 1)
          .filter((other) => sharedStretches(pointsOf(route), pointsOf(other)) > 0)
          .map((other) => `${route.line.id} and ${other.line.id}`),
      );
      expect(sharing).toEqual([]);
    });

    it("draws only level and upright stretches", () => {
      const slanted = routes.filter((route) => {
        const points = pointsOf(route);
        return points.slice(1).some((point, index) => {
          const before = points[index]!;
          return Math.abs(point[1] - before[1]) > EDGE && Math.abs(point[0] - before[0]) > EDGE;
        });
      });
      expect(slanted.map(({ line }) => line.id)).toEqual([]);
    });
  },
);

it("lets lines meet end to end on one level, as Branching narrow's c3 and c5 do", () => {
  const touching: Pt[][] = [
    [
      [0, 0],
      [10, 0],
    ],
    [
      [10, 0],
      [20, 0],
    ],
  ];
  expect(sharedStretches(touching[0]!, touching[1]!)).toBe(0);
  expect(
    sharedStretches(touching[0]!, [
      [5, 0],
      [20, 0],
    ]),
  ).toBe(5);
});

function fastest(scene: RouteScene, runs: number): number {
  rightAngles(scene);
  let best = Infinity;
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now();
    rightAngles(scene);
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

describe("drawing while a Stage is dragged", () => {
  // Measured on 2026-11-26: the fastest of 10 runs took 3.5 ms at 8 Stages and 15 lines, 6.6 ms
  // at 12 and 24, 8.3 ms at 24 and 40; so FULL_DRAWING in right-angles.ts is 8 Stages, 16 lines.
  it(`draws 8 Stages in full within the ${BUDGET_MS} ms budget`, () => {
    expect(fastest(gridScene(8, 16), 10)).toBeLessThan(BUDGET_MS * BUSY_RUN);
  });

  it("draws in full up to 8 Stages and 16 lines, even when asked to draw roughly", () => {
    const scene = gridScene(8, 16);
    const previous = rightAngles(gridScene(8, 16));
    expect(rightAngles(scene, { previous, moved: "stage-3" })).toEqual(rightAngles(scene));
  });

  describe("roughly, over that size", () => {
    const scene = gridScene(24, 40);
    const previous = rightAngles(scene);
    const moved = "stage-7";
    const box = scene.stages.get(moved)!.box;
    const shifted: RouteScene = {
      ...scene,
      stages: new Map(
        [...scene.stages].map(([key, stage]) => [
          key,
          key === moved
            ? {
                box: { ...box, y: box.y + 20 },
                rowCentres: stage.rowCentres.map((at) => at + 20),
              }
            : stage,
        ]),
      ),
    };
    const rough = rightAngles(shifted, { previous, moved });
    const before = new Map(previous.routes.map((route) => [route.line.id, route]));

    it("draws a route for every line, and bounds around them", () => {
      expect(rough.routes.map(({ line }) => line.id)).toEqual(shifted.lines.map(({ id }) => id));
      expect(rough.bounds).toBeDefined();
    });

    it("lays the moved Stage's lines again, from where its card now stands", () => {
      const card = shifted.stages.get(moved)!.box;
      const own = rough.routes.filter(({ line }) => line.fromKey === moved || line.to === moved);
      expect(own.length).toBeGreaterThan(0);
      const astray = own.filter((route) => {
        const end = route.line.fromKey === moved ? route.points[0]! : route.points.at(-1)!;
        return !(
          end.x >= card.x &&
          end.x <= card.x + card.width &&
          end.y >= card.y &&
          end.y <= card.y + card.height
        );
      });
      expect(astray.map(({ line }) => line.id)).toEqual([]);
      expect(
        own.some(
          (route) =>
            JSON.stringify(route.points) !== JSON.stringify(before.get(route.line.id)!.points),
        ),
      ).toBe(true);
    });

    it("keeps the other lines as the last full drawing laid them", () => {
      const kept = rough.routes.filter(
        ({ line }) =>
          line.fromKey !== moved &&
          line.to !== moved &&
          !lineHitsBox(pointsOf(before.get(line.id)!), shifted.stages.get(moved)!.box),
      );
      expect(kept.length).toBeGreaterThan(rough.routes.length / 2);
      expect(kept).toEqual(kept.map((route) => before.get(route.line.id)));
    });

    it("draws faster than in full, with no heavy search", () => {
      let [best, full] = [Infinity, Infinity];
      for (let run = 0; run < 5; run += 1) {
        let started = performance.now();
        rightAngles(shifted, { previous, moved });
        best = Math.min(best, performance.now() - started);
        started = performance.now();
        rightAngles(shifted);
        full = Math.min(full, performance.now() - started);
      }
      expect(best).toBeLessThan(full);
    });
  });
});
