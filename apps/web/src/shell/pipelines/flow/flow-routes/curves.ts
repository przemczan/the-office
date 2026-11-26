import type { RouteDrawer } from "./route-drawer.ts";
import { OUTWARD, OWN_LOOP, type RouteEnds } from "./route-ends.ts";
import { drawnRoutes, type RouteFrame, routeFrame } from "./route-frame.ts";
import {
  add,
  distance,
  type Pt,
  type RouteShape,
  type ShapePiece,
  shapePoints,
  straightShape,
  sub,
  times,
  towards,
} from "./route-geometry.ts";
import {
  CORNER_OUT,
  type CornerUses,
  type LaidLine,
  laidInArrivalOrder,
  ownBoxes,
  passesClear,
  wayRound,
} from "./way-round.ts";

/**
 * Curves (docs/design/pipeline-route-drawing.html, "Curves"): one smooth cubic curve per route,
 * from the sides and points of Right angles, square to both edges; a curve with a card in its way
 * goes round the card's corners as one smooth curve through them.
 */
export const curves: RouteDrawer = (scene) => {
  const frame = routeFrame(scene);
  const { ends, laid } = laidInArrivalOrder(frame, (tried) => laidCurves(frame, tried));
  return drawnRoutes(
    frame,
    frame.lines.map((line, index) => ({
      line,
      shape: laid[index]!.shape,
      fromPort: ends[index]!.fromPort,
    })),
    "middle",
  );
};

interface LaidCurve extends LaidLine {
  readonly shape: RouteShape;
}

function laidCurves(frame: RouteFrame, ends: readonly RouteEnds[]): readonly LaidCurve[] {
  const laid = frame.lines.map((_, index): LaidCurve => {
    const shape = plainCurve(frame, ends[index]!);
    return { shape, points: shapePoints(shape), corners: undefined };
  });
  const clear = laid.map(
    ({ points }, index) =>
      ends[index]!.own || passesClear(points, frame.obstacles, ownBoxes(frame.lines[index]!)),
  );
  const drawn = laid.map(({ points }, index) => (clear[index] ? points : []));
  const uses: CornerUses = new Map();
  for (const [index, line] of frame.lines.entries()) {
    if (clear[index]) continue;
    const own = ends[index]!;
    const into = add(own.to.point, times(OUTWARD[own.to.side], LEAD));
    const corners = wayRound(frame, uses, {
      from: own.from,
      to: { point: into, side: own.to.side },
      own: ownBoxes(line),
      out: CORNER_OUT,
      drawn,
    });
    if (!corners) continue;
    const through = [own.from.point, ...corners, into];
    const shape =
      SMOOTHNESS.map((reach) => curveThrough(through, own, reach)).find((each) =>
        passesClear(shapePoints(each), frame.obstacles, ownBoxes(line)),
      ) ?? straightShape([...through, own.to.point], FALLBACK_RADIUS);
    laid[index] = { shape, points: shapePoints(shape), corners };
    drawn[index] = laid[index].points;
  }
  return laid;
}

/** The last stretch runs this far straight into the target's edge, so the arrow lies along it. */
const LEAD = 12;
/** Between facing sides, each control point's reach is half the gap, at least this. */
const FACING_LEAST_REACH = 24;
/** Back over one side, the reach is this share of the span, within these. */
const BACK_REACH = { share: 0.3, least: 40, most: 160, mostNarrow: 64 } as const;
/** A curve round corners that comes too near a card is drawn again with its reach halved, twice. */
const SMOOTHNESS: readonly number[] = [1, 0.5, 0.25];
/**
 * A cubic stands out three quarters of its control points' reach, so a loop to its own Stage
 * stands OWN_LOOP.out off the edge.
 */
const OWN_LOOP_REACH = (OWN_LOOP.out * 4) / 3;
/** The fallback: straight stretches with corners rounded by this. */
const FALLBACK_RADIUS = 12;

/** The curve with no card in its way: one cubic piece, then the straight lead into the edge. */
function plainCurve(frame: RouteFrame, { from, to, own }: RouteEnds): RouteShape {
  const out = OUTWARD[from.side];
  const inward = OUTWARD[to.side];
  const into = add(to.point, times(inward, LEAD));
  const span = distance(from.point, to.point);
  const reach = own
    ? OWN_LOOP_REACH
    : from.side === to.side
      ? Math.min(
          frame.narrow ? BACK_REACH.mostNarrow : BACK_REACH.most,
          Math.max(BACK_REACH.least, BACK_REACH.share * span),
        )
      : Math.min(span / 2, Math.max(FACING_LEAST_REACH, gapBetween(from.point, to.point, out) / 2));
  return piecesFrom(from.point, [
    {
      to: into,
      bend: [
        add(from.point, times(out, reach)),
        add(into, times(inward, Math.max(0, reach - LEAD))),
      ],
    },
    { to: to.point },
  ]);
}

/** How far apart two points stand along the way out of the first one's edge. */
function gapBetween(from: Pt, to: Pt, out: Pt): number {
  const along = Math.abs(out[0]) > 0 ? 0 : 1;
  return Math.abs(to[along] - from[along]);
}

const piecesFrom = (start: Pt, pieces: readonly ShapePiece[]): RouteShape => ({
  start,
  pieces,
  radius: 0,
});

/**
 * One smooth curve through the points, then the lead into the edge: a cubic piece per stretch,
 * square to the edges at its ends, its direction at each corner along the line between the
 * corner's neighbours, its control points `reach` of a third of the stretch from each end.
 */
function curveThrough(points: readonly Pt[], { from, to }: RouteEnds, reach: number): RouteShape {
  const last = points.length - 1;
  const headings = points.map((point, index): Pt => {
    if (index === 0) return OUTWARD[from.side];
    if (index === last) return times(OUTWARD[to.side], -1);
    return towards(points[index - 1]!, points[index + 1]!);
  });
  const pieces = points.slice(1).map((point, index): ShapePiece => {
    const start = points[index]!;
    const third = (distance(start, point) / 3) * reach;
    return {
      to: point,
      bend: [
        add(start, times(headings[index]!, third)),
        sub(point, times(headings[index + 1]!, third)),
      ],
    };
  });
  return piecesFrom(points[0]!, [...pieces, { to: to.point }]);
}
