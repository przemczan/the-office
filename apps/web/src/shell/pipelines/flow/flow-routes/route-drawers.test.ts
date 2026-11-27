import { describe, expect, it } from "vitest";
import type { FlowBox, FlowOrientation, FlowPoint } from "../flow-layout.ts";
import type { DrawnRoute, RouteDrawing, RouteScene } from "./route-drawer.ts";
import { ROUTE_DRAWERS } from "./route-drawers.ts";
import { FIXTURE_NAMES, type FixtureName, fixtureScene } from "./route-fixtures.ts";
import {
  bottom,
  boxAround,
  boxesOverlap,
  centre,
  crossingsOf,
  distance,
  grown,
  lineHitsBox,
  type Pt,
  right,
} from "./route-geometry.ts";
import { MARK_AIR } from "./mark-spots.ts";

/**
 * The rules every way of drawing keeps on the three test Pipelines, wide and narrow
 * (docs/design/pipeline-route-drawing.html, "Tests" and "The test Pipelines").
 */

const ORIENTATIONS: readonly FlowOrientation[] = ["across", "down"];
const EDGE = 0.01;
/** Ends on one card stand at least this far apart. */
const ENDS_APART = 8;

/**
 * The design's table: the most crossings each mode may draw, per Pipeline, wide and narrow. Wide,
 * every route with a row leaves from it, so a lower row's line going up across a higher row's
 * going down is a crossing no drawing avoids (Loops' Review to itself against Review to Publish,
 * Branching's Implement to Review against Implement to Design); Curves also cross where two lines
 * turn back to one Stage's bottom edge at the same height.
 */
const MOST_CROSSINGS: Readonly<
  Record<RouteDrawing, Readonly<Record<FixtureName, Readonly<Record<FlowOrientation, number>>>>>
> = {
  "right-angles": {
    straight: { across: 0, down: 0 },
    loops: { across: 1, down: 0 },
    branching: { across: 1, down: 0 },
  },
  curves: {
    straight: { across: 0, down: 0 },
    loops: { across: 2, down: 0 },
    branching: { across: 1, down: 0 },
  },
  "straight-lines": {
    straight: { across: 0, down: 0 },
    loops: { across: 0, down: 0 },
    branching: { across: 4, down: 0 },
  },
};

/**
 * The routes with a limit that find no room for their mark and leave it to their rows ("Marks and
 * pressing"), all in the narrow view, across a band's 24 gap: Implement to Design in every mode,
 * and Loops' Tests back to Implement for Curves and Straight lines. No other may; wide, every one
 * has its mark.
 */
const MARKLESS_NARROW: Readonly<
  Record<RouteDrawing, Readonly<Record<FixtureName, readonly string[]>>>
> = {
  "right-angles": { straight: [], loops: [], branching: ["c6"] },
  curves: { straight: [], loops: ["b3"], branching: ["c6"] },
  "straight-lines": { straight: [], loops: ["b3"], branching: ["c6"] },
};

const pointsOf = (route: DrawnRoute): readonly Pt[] => route.points.map(({ x, y }): Pt => [x, y]);

function cardOf(scene: RouteScene, key: string | null): FlowBox {
  const box = key === null ? scene.end : scene.stages.get(key)?.box;
  if (!box) throw new Error(`No card for ${String(key)}`);
  return box;
}

const cardsOf = (scene: RouteScene): readonly FlowBox[] => [
  ...[...scene.stages.values()].map(({ box }) => box),
  ...(scene.end ? [scene.end] : []),
];

/** Whether the point is in the box or on its edge. */
const touches = (box: FlowBox, [x, y]: Pt): boolean =>
  x >= box.x - EDGE && x <= right(box) + EDGE && y >= box.y - EDGE && y <= bottom(box) + EDGE;

/** Whether the point lies on the box's edge. */
const near = (a: number, b: number): boolean => Math.abs(a - b) <= EDGE;

function onEdge(box: FlowBox, point: Pt): boolean {
  const [x, y] = point;
  return (
    touches(box, point) &&
    (near(x, box.x) || near(x, right(box)) || near(y, box.y) || near(y, bottom(box)))
  );
}

/** The arrow head's tip: its polygon's first point. */
function arrowTip(route: DrawnRoute): Pt {
  const [x, y] = route.arrow.split(" ")[0]!.split(",").map(Number);
  return [x!, y!];
}

const markBox = (scene: RouteScene, mark: FlowPoint): FlowBox =>
  boxAround([mark.x, mark.y], scene.mark.width, scene.mark.height);

/** The shortest distance from the point to the line. */
function distanceToLine(points: readonly Pt[], point: Pt): number {
  let nearest = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    const [a, b] = [points[i - 1]!, points[i]!];
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const length = dx * dx + dy * dy;
    const t =
      length === 0
        ? 0
        : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length));
    nearest = Math.min(nearest, distance(point, [a[0] + t * dx, a[1] + t * dy]));
  }
  return nearest;
}

const CASES = (Object.keys(ROUTE_DRAWERS) as RouteDrawing[]).flatMap((drawing) =>
  FIXTURE_NAMES.flatMap((fixture) =>
    ORIENTATIONS.map((orientation) => ({ drawing, fixture, orientation })),
  ),
);

describe.each(CASES)(
  "$drawing draws $fixture $orientation",
  ({ drawing, fixture, orientation }) => {
    const scene = fixtureScene(fixture, orientation);
    const drawn = ROUTE_DRAWERS[drawing](scene);
    const cards = cardsOf(scene);

    it("draws a route for every line, in the lines' order", () => {
      expect(drawn.routes.map(({ line }) => line.id)).toEqual(scene.lines.map(({ id }) => id));
      expect(drawn.bounds).toBeDefined();
    });

    it("runs no line through a card, touching its own cards only at its ends", () => {
      const through = drawn.routes.filter((route) => {
        const points = pointsOf(route);
        return cards.some(
          (card) =>
            lineHitsBox(points, card) || points.slice(1, -1).some((point) => touches(card, point)),
        );
      });
      expect(through.map(({ line }) => line.id)).toEqual([]);
    });

    it("starts each line on its Stage's edge and ends it on its target's, under its arrow's tip", () => {
      const astray = drawn.routes.filter((route) => {
        const points = pointsOf(route);
        const target = cardOf(scene, route.line.to);
        return !(
          onEdge(cardOf(scene, route.line.fromKey), points[0]!) &&
          onEdge(target, points.at(-1)!) &&
          distance(arrowTip(route), points.at(-1)!) < 0.02 &&
          onEdge(target, arrowTip(route))
        );
      });
      expect(astray.map(({ line }) => line.id)).toEqual([]);
    });

    it("leaves each route listed as a row from its row's port, on the side its target is on", () => {
      const lists = drawn.routes.filter(({ line }) => line.port !== undefined);
      const wrong = lists.filter((route) => {
        const stage = scene.stages.get(route.line.fromKey)!;
        const target = cardOf(scene, route.line.to);
        const [x, y] = pointsOf(route)[0]!;
        if (drawing === "straight-lines" || orientation === "down")
          return route.fromPort !== undefined;
        const side = centre(target)[0] >= centre(stage.box)[0] ? "right" : "left";
        const edge = side === "right" ? right(stage.box) : stage.box.x;
        return !(
          route.fromPort === side &&
          near(x, edge) &&
          near(y, stage.rowCentres[route.line.port!]!)
        );
      });
      expect(fixture === "straight" || lists.length > 0).toBe(true);
      expect(wrong.map(({ line }) => line.id)).toEqual([]);
    });

    it("brings each route back onto its target, its arrow there", () => {
      const back = drawn.routes.filter(({ line }) => line.limit !== null);
      expect(back.length).toBe(scene.lines.filter(({ limit }) => limit !== null).length);
      const astray = back.filter((route) => {
        const target = cardOf(scene, route.line.to);
        return !(onEdge(target, pointsOf(route).at(-1)!) && onEdge(target, arrowTip(route)));
      });
      expect(astray.map(({ line }) => line.id)).toEqual([]);
    });

    it(`keeps the ends on one card at least ${ENDS_APART} apart`, () => {
      const ends = new Map<FlowBox, { id: string; point: Pt }[]>();
      for (const route of drawn.routes) {
        const points = pointsOf(route);
        for (const [card, point] of [
          [cardOf(scene, route.line.fromKey), points[0]!],
          [cardOf(scene, route.line.to), points.at(-1)!],
        ] as const)
          ends.set(card, [...(ends.get(card) ?? []), { id: route.line.id, point }]);
      }
      const close = [...ends.values()].flatMap((onCard) =>
        onCard.flatMap((one, index) =>
          onCard
            .slice(index + 1)
            .filter((other) => distance(one.point, other.point) < ENDS_APART - EDGE)
            .map((other) => `${one.id} and ${other.id}`),
        ),
      );
      expect(close).toEqual([]);
    });

    it("sets each mark on its own line, clear of every card, other line and other mark", () => {
      const faults = drawn.routes.flatMap((route): string[] => {
        if (!route.mark) return [];
        const box = markBox(scene, route.mark);
        const aired = grown(box, MARK_AIR - EDGE);
        const id = route.line.id;
        return [
          ...(route.line.limit === null ? [`${id} has no limit`] : []),
          ...(distanceToLine(pointsOf(route), [route.mark.x, route.mark.y]) < 0.5
            ? []
            : [`${id} off its line`]),
          ...(cards.some((card) => boxesOverlap(aired, card)) ? [`${id} on a card`] : []),
          ...drawn.routes
            .filter((other) => other !== route)
            .flatMap((other) => [
              ...(lineHitsBox(pointsOf(other), aired) ? [`${id} on ${other.line.id}`] : []),
              ...(other.mark && boxesOverlap(box, markBox(scene, other.mark))
                ? [`${id} on ${other.line.id}'s mark`]
                : []),
            ]),
        ];
      });
      expect(faults).toEqual([]);
    });

    it("gives every route with a limit its mark, but those known to have no room", () => {
      const markless = drawn.routes.filter(({ line, mark }) => line.limit !== null && !mark);
      const allowed = orientation === "down" ? MARKLESS_NARROW[drawing][fixture] : [];
      expect(markless.map(({ line }) => line.id).filter((id) => !allowed.includes(id))).toEqual([]);
      expect(markless.length).toBeLessThanOrEqual(1);
    });

    it(`crosses no more than the table's ${MOST_CROSSINGS[drawing][fixture][orientation]}`, () => {
      let crossings = 0;
      for (const [index, route] of drawn.routes.entries())
        for (const other of drawn.routes.slice(index + 1))
          crossings += crossingsOf(pointsOf(route), pointsOf(other));
      expect(crossings).toBeLessThanOrEqual(MOST_CROSSINGS[drawing][fixture][orientation]);
    });

    it("draws the same again from the same scene", () => {
      expect(ROUTE_DRAWERS[drawing](fixtureScene(fixture, orientation))).toEqual(drawn);
    });
  },
);
