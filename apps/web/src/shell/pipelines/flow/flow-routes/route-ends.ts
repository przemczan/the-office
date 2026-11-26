import type { FlowBox } from "../flow-layout.ts";
import { bottom, centre, grown, type Pt, right, stretchHitsBox } from "./route-geometry.ts";
import { MARK_AIR } from "./mark-spots.ts";
import type { FrameCard, FrameLine, RouteFrame } from "./route-frame.ts";

/**
 * Which side of its two cards a line uses, and where on each (docs/design/pipeline-route-drawing.html,
 * "Which sides a line uses" and "On a side"), in the frame. Right angles and Curves share them, so a
 * line leaves its row's port and a route back enters the same edge in both.
 */

export type Side = "top" | "right" | "bottom" | "left";

/** The way out of a card through each side. */
export const OUTWARD: Readonly<Record<Side, Pt>> = {
  top: [0, -1],
  right: [1, 0],
  bottom: [0, 1],
  left: [-1, 0],
};

export interface RouteEnd {
  readonly point: Pt;
  readonly side: Side;
}

export interface RouteEnds {
  readonly from: RouteEnd;
  readonly to: RouteEnd;
  /** The line leaves its row's port. */
  readonly fromPort: boolean;
  /** A route to its own Stage: the small loop on one edge. */
  readonly own: boolean;
}

/** A target counts as ahead, below or above from this far off the Stage's edge. */
const AHEAD = 24;
/** Points on a side stand this far apart, less on a crowded side, never under `LEAST_APART`. */
const APART = 16;
const LEAST_APART = 8;
/** Points keep this clear of the card's corners. */
const CORNER_CLEAR = 12;
/** A route to its own Stage: its loop's width and how far out it runs. */
export const OWN_LOOP = { width: 56, out: 24 } as const;
/** With a card nearer than this over its top edge, the loop takes the bottom edge. */
const OWN_LOOP_ROOM = 40;

type Role = "from" | "to";

/** One end of a line, or both ends of a loop to its own Stage, to place on a card's side. */
interface SideEnd {
  readonly line: number;
  /** A loop's two ends go as one: it enters here and leaves `width` further on. */
  readonly role: Role | "own";
  readonly width: number;
  /** Where the end is fixed: its row's port. */
  readonly fixed: number | undefined;
  readonly rank: readonly [number, number];
  /** Its line carries a ≤N× mark, which may sit on the stretch leaving this side. */
  readonly marked: boolean;
}

/**
 * Where an end belongs among its side's other ends, by its line and role (`endKey`), for a drawer
 * that knows better than where the two cards stand: the way its line was routed.
 */
export type EndOrder = ReadonlyMap<string, readonly [number, number]>;

export const endKey = (line: number, role: "from" | "to"): string => `${line}:${role}`;

/** Each line's two ends, in the frame's lines' order. */
export function routeEnds(frame: RouteFrame, order?: EndOrder): readonly RouteEnds[] {
  const sides = withFullSidesEased(
    frame,
    frame.lines.map((line) => sidesOf(line, frame)),
  );
  const groups = new Map<string, { card: FrameCard; side: Side; ends: SideEnd[] }>();
  const put = (card: FrameCard, side: Side, end: SideEnd): void => {
    const key = `${frame.cards.indexOf(card)}:${side}`;
    const group = groups.get(key) ?? { card, side, ends: [] };
    group.ends.push(end);
    groups.set(key, group);
  };
  for (const [index, line] of frame.lines.entries()) {
    const { from, to } = sides[index]!;
    if (line.from === line.to) {
      const width = ownLoopWidth(line.from.box);
      put(line.from, from, {
        line: index,
        role: "own",
        width,
        fixed: undefined,
        rank: [1, 0],
        marked: false,
      });
      continue;
    }
    const back = from === to;
    const marked = line.line.limit !== null;
    const row =
      from === "right" && line.line.port !== undefined ? line.from.rows[line.line.port] : undefined;
    put(line.from, from, {
      line: index,
      role: "from",
      width: 0,
      fixed: row,
      rank: order?.get(endKey(index, "from")) ?? rankOf(line.from.box, line.to.box, from, back),
      marked,
    });
    put(line.to, to, {
      line: index,
      role: "to",
      width: 0,
      fixed: undefined,
      rank: order?.get(endKey(index, "to")) ?? rankOf(line.to.box, line.from.box, to, back),
      marked,
    });
  }
  const at = new Map<string, number>();
  const placed = [...groups.values()].map((group) => {
    const beside = (level(group.side) ? frame.mark.width : frame.mark.height) / 2 + MARK_AIR;
    const spots = placedOnSide(
      group.ends,
      group.card.box,
      group.side,
      reservedOn(frame, group),
      beside,
    );
    for (const [end, spot] of spots) at.set(`${end.line}:${end.role}`, spot);
    return { ...group, spots };
  });
  slideStraight(frame, sides, at, placed);
  return frame.lines.map((line, index): RouteEnds => {
    const { from, to } = sides[index]!;
    const own = at.get(`${index}:own`);
    if (own !== undefined) {
      const width = ownLoopWidth(line.from.box);
      return {
        from: { side: from, point: pointOn(line.from.box, from, own + width) },
        to: { side: to, point: pointOn(line.to.box, to, own) },
        fromPort: false,
        own: true,
      };
    }
    return {
      from: { side: from, point: pointOn(line.from.box, from, at.get(`${index}:from`)!) },
      to: { side: to, point: pointOn(line.to.box, to, at.get(`${index}:to`)!) },
      fromPort:
        from === "right" &&
        line.line.port !== undefined &&
        line.from.rows[line.line.port] !== undefined,
      own: false,
    };
  });
}

/** The sides by where the target stands, the first rule that fits. */
function sidesOf({ from, to }: FrameLine, frame: RouteFrame): { from: Side; to: Side } {
  if (from === to) {
    const side = ownLoopSide(from.box, frame.cards);
    return { from: side, to: side };
  }
  if (to.box.x >= right(from.box) + AHEAD) return { from: "right", to: "left" };
  if (to.box.y >= bottom(from.box) + AHEAD) return { from: "bottom", to: "top" };
  if (bottom(to.box) <= from.box.y - AHEAD) return { from: "top", to: "bottom" };
  const others = frame.cards.filter((card) => card !== from && card !== to).map(({ box }) => box);
  const low = Math.min(from.box.x, to.box.x);
  const high = Math.max(right(from.box), right(to.box));
  const inSpan = others.filter((box) => box.x < high && right(box) > low);
  const over = inSpan.filter((box) => box.y < Math.max(from.box.y, to.box.y)).length;
  const under = inSpan.filter(
    (box) => bottom(box) > Math.min(bottom(from.box), bottom(to.box)),
  ).length;
  return under < over ? { from: "bottom", to: "bottom" } : { from: "top", to: "top" };
}

function ownLoopSide(box: FlowBox, cards: readonly FrameCard[]): Side {
  const crowded = cards.some(
    ({ box: other }) =>
      other !== box &&
      other.x < right(box) &&
      right(other) > box.x &&
      bottom(other) <= box.y &&
      box.y - bottom(other) < OWN_LOOP_ROOM,
  );
  return crowded ? "bottom" : "top";
}

function ownLoopWidth(box: FlowBox): number {
  return Math.max(APART, Math.min(OWN_LOOP.width, box.width / 2 - CORNER_CLEAR));
}

/**
 * A full side: a left edge that can't take one more point at 8 apart sends the lines that come
 * last in the Pipeline's order to the top or bottom edge, whichever faces where they come from.
 */
function withFullSidesEased(
  frame: RouteFrame,
  sides: readonly { from: Side; to: Side }[],
): readonly { from: Side; to: Side }[] {
  const entering = new Map<FrameCard, number>();
  return sides.map((own, index) => {
    const { from, to } = frame.lines[index]!;
    if (own.to !== "left") return own;
    const count = (entering.get(to) ?? 0) + 1;
    entering.set(to, count);
    const room = Math.floor((to.box.height - 2 * CORNER_CLEAR) / LEAST_APART) + 1;
    if (count <= room) return own;
    return { from: own.from, to: centre(from.box)[1] <= centre(to.box)[1] ? "top" : "bottom" };
  });
}

/** Whether the side runs along x. */
const level = (side: Side): boolean => side === "top" || side === "bottom";

function pointOn(box: FlowBox, side: Side, at: number): Pt {
  if (side === "top") return [at, box.y];
  if (side === "bottom") return [at, bottom(box)];
  return [side === "left" ? box.x : right(box), at];
}

/**
 * Where an end goes among the others on its side, so lines don't cross on the way out. An end
 * whose other end is beyond this side goes by where that stands. The ends of lines that turn back
 * over the same side of both cards nest round those: the further its other end, the nearer the
 * middle.
 */
function rankOf(
  box: FlowBox,
  other: FlowBox,
  side: Side,
  back: boolean,
): readonly [number, number] {
  const axis = level(side) ? 0 : 1;
  const here = centre(box)[axis];
  const there = centre(other)[axis];
  if (!back) return [1, there];
  return there < here ? [0, here - there] : [2, here - there];
}

/** Places on a side nothing else may take: the start marker's, on the first Stage's left edge. */
function reservedOn(
  frame: RouteFrame,
  { card, side }: { readonly card: FrameCard; readonly side: Side },
): readonly number[] {
  return card === frame.start && side === "left" ? [centre(card.box)[1]] : [];
}

/**
 * Each end's place along its side: one takes the middle, several stand 16 apart round it in their
 * rank's order, closer on a crowded side, and `beside` apart next to a line with a ≤N× mark where
 * the side has room, so the mark fits by its neighbour; a loop to the Stage itself enters at the
 * middle.
 */
function placedOnSide(
  ends: readonly SideEnd[],
  box: FlowBox,
  side: Side,
  reserved: readonly number[],
  beside: number,
): Map<SideEnd, number> {
  const [start, size] = level(side) ? [box.x, box.width] : [box.y, box.height];
  const low = start + Math.min(CORNER_CLEAR, size / 2);
  const high = start + size - Math.min(CORNER_CLEAR, size / 2);
  const middle = start + size / 2;
  const spots = new Map<SideEnd, number>();
  for (const end of ends) if (end.fixed !== undefined) spots.set(end, end.fixed);
  const taken = [...reserved, ...spots.values()];
  const loose = ends
    .filter((end) => end.fixed === undefined)
    .toSorted((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.line - b.line);
  const widths = loose.reduce((sum, { width }) => sum + width, 0);
  const gap =
    loose.length > 1
      ? Math.min(APART, Math.max(LEAST_APART, (high - low - widths) / (loose.length - 1)))
      : 0;
  const gaps = gapsAfter(loose, gap, beside, high - low - widths);
  const span = widths + gaps.reduce((sum, each) => sum + each, 0);
  const loop = loose.findIndex(({ role }) => role === "own");
  const lead = loose
    .slice(0, Math.max(loop, 0))
    .reduce((sum, { width }, index) => sum + width + gaps[index]!, 0);
  let at = Math.max(low, Math.min(high - span, loop < 0 ? middle - span / 2 : middle - lead));
  for (const [index, end] of loose.entries()) {
    const spot = end.width > 0 ? at : clearSpot(at, low, high, taken);
    spots.set(end, spot);
    taken.push(spot);
    at += end.width + (gaps[index] ?? 0);
  }
  return spots;
}

/** The gap after each end but the last: `beside` next to a marked line, when all of them fit. */
function gapsAfter(
  ends: readonly SideEnd[],
  gap: number,
  beside: number,
  room: number,
): readonly number[] {
  const even = ends.slice(1).map(() => gap);
  const widened = ends
    .slice(1)
    .map((end, index) => (end.marked || ends[index]!.marked ? Math.max(gap, beside) : gap));
  return widened.reduce((sum, each) => sum + each, 0) <= room ? widened : even;
}

/** The place nearest `wanted` that keeps 8 from every place taken; `wanted` itself with none. */
function clearSpot(wanted: number, low: number, high: number, taken: readonly number[]): number {
  const clear = (spot: number): boolean =>
    taken.every((other) => Math.abs(other - spot) >= LEAST_APART);
  for (let step = 0; step <= high - low; step += LEAST_APART / 2) {
    for (const spot of [wanted + step, wanted - step])
      if (spot >= low && spot <= high && clear(spot)) return spot;
  }
  return wanted;
}

interface PlacedSide {
  readonly card: FrameCard;
  readonly side: Side;
  readonly spots: Map<SideEnd, number>;
}

const FACING: readonly (readonly [Side, Side])[] = [
  ["right", "left"],
  ["bottom", "top"],
  ["top", "bottom"],
];

/**
 * An end slides along its side when that makes its line straight: it stays in its place among the
 * side's other ends and 8 clear of them, and the straight line passes no card. The entering end
 * slides first; the leaving one when it can't and has no row to keep.
 */
function slideStraight(
  frame: RouteFrame,
  sides: readonly { from: Side; to: Side }[],
  at: Map<string, number>,
  placed: readonly PlacedSide[],
): void {
  for (const [index, line] of frame.lines.entries()) {
    const { from, to } = sides[index]!;
    if (!FACING.some(([leave, enter]) => leave === from && enter === to)) continue;
    const ends = { from: at.get(`${index}:from`)!, to: at.get(`${index}:to`)! };
    if (ends.from === ends.to) continue;
    for (const role of ["to", "from"] as const) {
      const [card, side, wanted] =
        role === "to" ? [line.to, to, ends.from] : [line.from, from, ends.to];
      const group = placed.find((each) => each.card === card && each.side === side);
      const own = [...(group?.spots.keys() ?? [])].find(
        (end) => end.line === index && end.role === role,
      );
      if (!group || !own || own.fixed !== undefined) continue;
      if (!mayTake(group, own, wanted, reservedOn(frame, group))) continue;
      const a = pointOn(line.from.box, from, role === "from" ? wanted : ends.from);
      const b = pointOn(line.to.box, to, role === "to" ? wanted : ends.to);
      const blocked = frame.obstacles.some(
        (box) =>
          box !== line.from.box && box !== line.to.box && stretchHitsBox(a, b, grown(box, 4)),
      );
      if (blocked) continue;
      group.spots.set(own, wanted);
      at.set(`${index}:${role}`, wanted);
      break;
    }
  }
}

function mayTake(
  { card, side, spots }: PlacedSide,
  own: SideEnd,
  wanted: number,
  reserved: readonly number[],
): boolean {
  const [start, size] = level(side) ? [card.box.x, card.box.width] : [card.box.y, card.box.height];
  const clear = Math.min(CORNER_CLEAR, size / 2);
  if (wanted < start + clear || wanted > start + size - clear) return false;
  const now = spots.get(own)!;
  const others = [
    ...reserved.map((spot) => ({ spot, reach: 0 })),
    ...[...spots].filter(([end]) => end !== own).map(([end, spot]) => ({ spot, reach: end.width })),
  ];
  return others.every(({ spot, reach }) =>
    now < spot ? wanted <= spot - LEAST_APART : wanted >= spot + reach + LEAST_APART,
  );
}
