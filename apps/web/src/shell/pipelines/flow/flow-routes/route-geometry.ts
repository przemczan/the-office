import type { FlowBox } from "../flow-layout.ts";

/**
 * The sums the route drawers share (docs/design/pipeline-route-drawing.html): points, boxes, and a
 * line's shape, which is straight pieces with rounded corners, curved pieces, or both.
 */

export type Pt = readonly [number, number];

export const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
export const times = (a: Pt, by: number): Pt => [a[0] * by, a[1] * by];
export const distance = (a: Pt, b: Pt): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** The direction from a to b, one long; none between a point and itself. */
export function towards(a: Pt, b: Pt): Pt {
  const length = distance(a, b);
  return length === 0 ? [0, 0] : [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
}

export const right = (box: FlowBox): number => box.x + box.width;
export const bottom = (box: FlowBox): number => box.y + box.height;
export const centre = (box: FlowBox): Pt => [box.x + box.width / 2, box.y + box.height / 2];

export function grown(box: FlowBox, by: number): FlowBox {
  return { x: box.x - by, y: box.y - by, width: box.width + 2 * by, height: box.height + 2 * by };
}

export function boxAround(middle: Pt, width: number, height: number): FlowBox {
  return { x: middle[0] - width / 2, y: middle[1] - height / 2, width, height };
}

/** Whether two boxes share more than an edge. */
export function boxesOverlap(a: FlowBox, b: FlowBox): boolean {
  return a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);
}

export function boxHolds(box: FlowBox, [x, y]: Pt): boolean {
  return x > box.x && x < right(box) && y > box.y && y < bottom(box);
}

/**
 * The part of the stretch from a to b inside the box, as the two shares of the way (0 at a, 1 at
 * b) where it comes in and goes out; undefined when it only touches the box's edge or misses it.
 */
export function stretchInBox(a: Pt, b: Pt, box: FlowBox): readonly [number, number] | undefined {
  let enter = 0;
  let leave = 1;
  const sides: readonly (readonly [number, number, number])[] = [
    [b[0] - a[0], box.x - a[0], right(box) - a[0]],
    [b[1] - a[1], box.y - a[1], bottom(box) - a[1]],
  ];
  for (const [step, low, high] of sides) {
    if (step === 0) {
      if (low >= 0 || high <= 0) return undefined;
      continue;
    }
    const [near, far] = step > 0 ? [low / step, high / step] : [high / step, low / step];
    enter = Math.max(enter, near);
    leave = Math.min(leave, far);
  }
  return leave - enter > 1e-9 ? [enter, leave] : undefined;
}

/** Whether the stretch from a to b runs through the box, more than along its edge. */
export const stretchHitsBox = (a: Pt, b: Pt, box: FlowBox): boolean =>
  stretchInBox(a, b, box) !== undefined;

export function lineHitsBox(points: readonly Pt[], box: FlowBox): boolean {
  return points.some((point, index) => index > 0 && stretchHitsBox(points[index - 1]!, point, box));
}

const turn = (a: Pt, b: Pt, c: Pt): number =>
  Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));

/** Whether two stretches cross, each passing to the other's far side. */
export function stretchesCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  return turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0;
}

/** How many times two lines cross. */
export function crossingsOf(one: readonly Pt[], other: readonly Pt[]): number {
  let count = 0;
  for (let i = 1; i < one.length; i += 1)
    for (let j = 1; j < other.length; j += 1)
      if (stretchesCross(one[i - 1]!, one[i]!, other[j - 1]!, other[j]!)) count += 1;
  return count;
}

export function lengthOf(points: readonly Pt[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) length += distance(points[i - 1]!, points[i]!);
  return length;
}

/** The point `at` along the line from its start, by length. */
export function pointAlong(points: readonly Pt[], at: number): Pt {
  let left = at;
  for (let i = 1; i < points.length; i += 1) {
    const [a, b] = [points[i - 1]!, points[i]!];
    const reach = distance(a, b);
    if (left <= reach && reach > 0) return add(a, times(sub(b, a), left / reach));
    left -= reach;
  }
  return points.at(-1) ?? [0, 0];
}

/** One piece of a line's shape, to a point: straight, or curved by two control points. */
export interface ShapePiece {
  readonly to: Pt;
  readonly bend?: readonly [Pt, Pt];
}

/**
 * A line's shape from its Stage's edge to its arrow's tip. Two straight pieces meet in a corner
 * rounded by `radius`; the last piece is straight, so the arrow lies along it.
 */
export interface RouteShape {
  readonly start: Pt;
  readonly pieces: readonly ShapePiece[];
  readonly radius: number;
}

export function straightShape(points: readonly Pt[], radius: number): RouteShape {
  const kept = points.filter((point, i) => i === 0 || distance(point, points[i - 1]!) > 1e-6);
  return { start: kept[0] ?? [0, 0], pieces: kept.slice(1).map((to) => ({ to })), radius };
}

/** How many straight steps stand for a curved piece. */
const CURVE_STEPS = 16;

function curvePoint(from: Pt, [c1, c2]: readonly [Pt, Pt], to: Pt, t: number): Pt {
  const u = 1 - t;
  const weigh = (k: 0 | 1): number =>
    u * u * u * from[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * to[k];
  return [weigh(0), weigh(1)];
}

/** The shape as a line of straight steps: its corners unrounded, each curved piece in 16 steps. */
export function shapePoints({ start, pieces }: RouteShape): readonly Pt[] {
  const points: Pt[] = [start];
  let from = start;
  for (const { to, bend } of pieces) {
    if (bend)
      for (let step = 1; step < CURVE_STEPS; step += 1)
        points.push(curvePoint(from, bend, to, step / CURVE_STEPS));
    points.push(to);
    from = to;
  }
  return points;
}

/** The way the shape's last piece runs: the way its arrow points. */
export function shapeHeading({ start, pieces }: RouteShape): Pt {
  const from = pieces.at(-2)?.to ?? start;
  return towards(from, pieces.at(-1)?.to ?? start);
}

const round = (value: number): number => Math.round(value * 100) / 100;
const spot = ([x, y]: Pt): string => `${round(x)},${round(y)}`;

/** The shape's SVG path, stopping `trim` short of its end, where the arrow head takes over. */
export function shapePath(shape: RouteShape, trim: number): string {
  const { start, radius } = shape;
  const last = shape.pieces.at(-1);
  if (!last) return "";
  const before = shape.pieces.at(-2)?.to ?? start;
  const short = Math.min(trim, distance(before, last.to) / 2);
  const pieces = [
    ...shape.pieces.slice(0, -1),
    { ...last, to: sub(last.to, times(shapeHeading(shape), short)) },
  ];
  let d = `M${spot(start)}`;
  let from = start;
  for (const [index, piece] of pieces.entries()) {
    const next = pieces[index + 1];
    if (piece.bend) d += ` C${spot(piece.bend[0])} ${spot(piece.bend[1])} ${spot(piece.to)}`;
    else if (next && !next.bend && radius > 0) d += ` ${corner(from, piece.to, next.to, radius)}`;
    else d += ` L${spot(piece.to)}`;
    from = piece.to;
  }
  return d;
}

function corner(before: Pt, at: Pt, after: Pt, radius: number): string {
  const r = Math.min(radius, distance(before, at) / 2, distance(at, after) / 2);
  const into = sub(at, times(towards(before, at), r));
  const out = add(at, times(towards(at, after), r));
  return `L${spot(into)} Q${spot(at)} ${spot(out)}`;
}

/** An arrow head's polygon points: its tip at `tip`, pointing along `heading`. */
export function arrowAt(tip: Pt, heading: Pt): string {
  const back = sub(tip, times(heading, 7));
  const across: Pt = [-heading[1] * 4, heading[0] * 4];
  return [tip, add(back, across), sub(back, across)].map(spot).join(" ");
}
