import type { FlowBox } from "../flow-layout.ts";
import {
  type EndOrder,
  endKey,
  OUTWARD,
  type RouteEnds,
  routeEnds,
  type Side,
} from "./route-ends.ts";
import type { FrameLine, RouteFrame } from "./route-frame.ts";
import {
  boxHolds,
  bottom,
  crossingsOf,
  distance,
  grown,
  lineHitsBox,
  type Pt,
  right,
  sub,
} from "./route-geometry.ts";

/**
 * The way round the cards in a line's way that Curves and Straight lines share
 * (docs/design/pipeline-route-drawing.html, "Curves" and "Straight lines"): the shortest way
 * through the corners of the cards grown by 16, each further line round the same corner 16
 * further out, with a price on every crossing of a line already drawn.
 */

/** A line passing nearer than this to a card other than its own two counts as in its way. */
export const CARD_CLEAR = 8;
/** How far off its card a corner of a way round stands. */
export const CORNER_OUT = 16;
/** What a way round pays for crossing a line already drawn, against its length, as Right angles. */
export const CROSSING = 192;
/** Each further line round the same corner goes this much further out. */
export const LINES_APART = 16;

/** One end of a way round: where it starts or stops, and the side of the card it is on. */
export interface WayEnd {
  readonly point: Pt;
  readonly side: Side;
}

export interface WayAsked {
  readonly from: WayEnd;
  readonly to: WayEnd;
  /** The line's own two cards, which it may touch but never run through. */
  readonly own: readonly FlowBox[];
  /** How far off the cards the corners stand, before any further line round them. */
  readonly out: number;
  readonly drawn: readonly (readonly Pt[])[];
}

/** How many lines already go round each corner, by `obstacle index:corner index`. */
export type CornerUses = Map<string, number>;

/** The two cards a line runs between. */
export const ownBoxes = ({ from, to }: FrameLine): readonly FlowBox[] => [from.box, to.box];

/** Whether the line runs through none of its own cards and keeps 8 clear of every other one. */
export function passesClear(
  points: readonly Pt[],
  obstacles: readonly FlowBox[],
  own: readonly FlowBox[],
): boolean {
  return obstacles.every(
    (box) => !lineHitsBox(points, own.includes(box) ? box : grown(box, CARD_CLEAR)),
  );
}

const CORNERS: readonly Pt[] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

interface Corner {
  readonly key: string;
  readonly point: Pt;
}

function cornersOf(obstacles: readonly FlowBox[], out: number, uses: CornerUses): Corner[] {
  return obstacles.flatMap((box, index) =>
    CORNERS.flatMap(([x, y], corner): Corner[] => {
      const key = `${index}:${corner}`;
      const reach = out + LINES_APART * (uses.get(key) ?? 0);
      const point: Pt = [
        x < 0 ? box.x - reach : right(box) + reach,
        y < 0 ? box.y - reach : bottom(box) + reach,
      ];
      const free = obstacles.every((other) => !boxHolds(grown(other, CARD_CLEAR), point));
      return free ? [{ key, point }] : [];
    }),
  );
}

/** Whether the way from the end to the point runs out of its card's side, not along or into it. */
export function runsOutOf({ point, side }: WayEnd, to: Pt): boolean {
  const [x, y] = sub(to, point);
  const [outX, outY] = OUTWARD[side];
  return x * outX + y * outY > 0;
}

/**
 * The corners of the cheapest way from one end to the other, running out of each end's side so it
 * never runs along its card's edge; undefined with no way. The corners it takes
 * count as used, so the next line round them goes further out.
 */
export function wayRound(
  frame: RouteFrame,
  uses: CornerUses,
  asked: WayAsked,
): readonly Pt[] | undefined {
  const corners = cornersOf(frame.obstacles, asked.out, uses);
  const nodes: readonly Pt[] = [
    asked.from.point,
    asked.to.point,
    ...corners.map(({ point }) => point),
  ];
  const goal = 1;
  const cost = (a: number, b: number): number | undefined => {
    if (b === 0 || a === goal) return undefined;
    const [p, q] = [nodes[a]!, nodes[b]!];
    if (a === 0 && !runsOutOf(asked.from, q)) return undefined;
    if (b === goal && !runsOutOf(asked.to, p)) return undefined;
    if (!passesClear([p, q], frame.obstacles, asked.own)) return undefined;
    const crossings = asked.drawn.reduce((sum, line) => sum + crossingsOf([p, q], line), 0);
    return distance(p, q) + CROSSING * crossings;
  };
  const best = nodes.map((_, index) => (index === 0 ? 0 : Infinity));
  const before = nodes.map((): number | undefined => undefined);
  const done = new Set<number>();
  for (;;) {
    let at = -1;
    for (const [index, value] of best.entries())
      if (!done.has(index) && value < Infinity && (at < 0 || value < best[at]!)) at = index;
    if (at < 0) return undefined;
    if (at === goal) break;
    done.add(at);
    for (let next = 0; next < nodes.length; next += 1) {
      if (done.has(next)) continue;
      const step = cost(at, next);
      if (step !== undefined && best[at]! + step < best[next]!) {
        best[next] = best[at]! + step;
        before[next] = at;
      }
    }
  }
  const taken: number[] = [];
  for (let at = before[goal]; at !== undefined && at !== 0; at = before[at]) taken.unshift(at);
  for (const node of taken) {
    const { key } = corners[node - 2]!;
    uses.set(key, (uses.get(key) ?? 0) + 1);
  }
  return taken.map((node) => nodes[node]!);
}

/** A line as a drawer laid it: its points from edge to edge, and the corners it went round. */
export interface LaidLine {
  readonly points: readonly Pt[];
  readonly corners: readonly Pt[] | undefined;
}

/**
 * The lines laid from the ends of Right angles, then laid again with the ends of the lines that
 * went round a card put in the order those lines come to their sides; the drawing with fewer
 * crossings is kept, the first on a tie.
 */
export function laidInArrivalOrder<Laid extends LaidLine>(
  frame: RouteFrame,
  lay: (ends: readonly RouteEnds[]) => readonly Laid[],
): { readonly ends: readonly RouteEnds[]; readonly laid: readonly Laid[] } {
  const ends = routeEnds(frame);
  const laid = lay(ends);
  const order = arrivalOrder(ends, laid);
  if (order.size === 0) return { ends, laid };
  const reordered = routeEnds(frame, order);
  const again = lay(reordered);
  return crossingsIn(again) < crossingsIn(laid) ? { ends: reordered, laid: again } : { ends, laid };
}

/** Each end of a line round a card ranks among its side's ends by the corner it turns at first. */
function arrivalOrder(ends: readonly RouteEnds[], laid: readonly LaidLine[]): EndOrder {
  const order = new Map<string, readonly [number, number]>();
  for (const [line, { corners }] of laid.entries()) {
    const first = corners?.[0];
    const last = corners?.at(-1);
    if (!first || !last) continue;
    const own = ends[line]!;
    order.set(endKey(line, "from"), [1, first[alongSide(own.from.side)]]);
    order.set(endKey(line, "to"), [1, last[alongSide(own.to.side)]]);
  }
  return order;
}

/** The axis a side runs along. */
const alongSide = (side: Side): 0 | 1 => (side === "top" || side === "bottom" ? 0 : 1);

function crossingsIn(laid: readonly LaidLine[]): number {
  let count = 0;
  for (const [index, { points }] of laid.entries())
    for (const other of laid.slice(index + 1)) count += crossingsOf(points, other.points);
  return count;
}
