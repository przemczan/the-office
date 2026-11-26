import type { RouteDrawer } from "./route-drawer.ts";
import { OUTWARD, OWN_LOOP, type RouteEnds } from "./route-ends.ts";
import { drawnRoutes, type RouteFrame, routeFrame } from "./route-frame.ts";
import { add, type Pt, straightShape, times } from "./route-geometry.ts";
import {
  CORNER_OUT,
  type CornerUses,
  type LaidLine,
  laidInArrivalOrder,
  ownBoxes,
  passesClear,
  runsOutOf,
  wayRound,
} from "./way-round.ts";

/**
 * Straight lines (docs/design/pipeline-route-drawing.html, "Straight lines"): the direct line from
 * Stage to Stage, bent sharply only at the corners of a card in its way. A line that is clear is
 * never bent to dodge a crossing: in this mode crossings are the price of directness.
 */
export const straightLines: RouteDrawer = (scene) => {
  const frame = routeFrame(scene);
  const { laid } = laidInArrivalOrder(frame, (ends) => laidLines(frame, ends));
  return drawnRoutes(
    frame,
    frame.lines.map((line, index) => ({
      line,
      shape: straightShape(laid[index]!.points, 0),
      fromPort: false,
    })),
    "longest-stretch",
  );
};

/** A line that carries its mark goes round a card this far off it, so the mark fits beside. */
const MARKED_CORNER_OUT = 24;

function laidLines(frame: RouteFrame, ends: readonly RouteEnds[]): readonly LaidLine[] {
  const laid = ends.map((own): LaidLine => ({ points: plainLine(own), corners: undefined }));
  const clear = laid.map(({ points }, index) => {
    const own = ends[index]!;
    if (own.own) return true;
    // A direct line along its card's edge passes no card, but reads as part of the card.
    const square = runsOutOf(own.from, points[1]!) && runsOutOf(own.to, points[0]!);
    return square && passesClear(points, frame.obstacles, ownBoxes(frame.lines[index]!));
  });
  const drawn = laid.map(({ points }, index) => (clear[index] ? points : []));
  const uses: CornerUses = new Map();
  for (const [index, line] of frame.lines.entries()) {
    if (clear[index]) continue;
    const { from, to } = ends[index]!;
    const corners = wayRound(frame, uses, {
      from,
      to,
      own: ownBoxes(line),
      out: line.line.limit === null ? CORNER_OUT : MARKED_CORNER_OUT,
      drawn,
    });
    if (!corners) continue;
    laid[index] = { points: [from.point, ...corners, to.point], corners };
    drawn[index] = laid[index].points;
  }
  return laid;
}

/** The direct line; a route to its own Stage is the squared loop with sharp corners. */
function plainLine({ from, to, own }: RouteEnds): readonly Pt[] {
  if (!own) return [from.point, to.point];
  const out = times(OUTWARD[from.side], OWN_LOOP.out);
  return [from.point, add(from.point, out), add(to.point, out), to.point];
}
