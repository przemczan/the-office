import type { FlowBox } from "../flow-layout.ts";
import {
  boxAround,
  boxesOverlap,
  distance,
  grown,
  lengthOf,
  lineHitsBox,
  pointAlong,
  type Pt,
} from "./route-geometry.ts";

/**
 * Where each line's ≤N× mark sits (docs/design/pipeline-route-drawing.html, "Marks and pressing"):
 * on its own line, at the free spot nearest where its mode wants it, where the mark with 4 around
 * it touches no card, no other line and no other mark. A line with no free spot draws no mark; its
 * row shows the same limit.
 */

/**
 * Where a mode wants a mark: on a level stretch, the longest first, then an upright one (Right
 * angles); at the middle of the line by length (Curves); or at the middle of its longest stretch
 * (Straight lines). The last two slide along the whole line.
 */
export type MarkRule = "level-stretch" | "middle" | "longest-stretch";

export interface MarkedLine {
  readonly points: readonly Pt[];
  /** Whether the line has a limit, so a mark to place. */
  readonly marked: boolean;
}

interface MarkRoom {
  /** True when the frame is the narrow view's, where a level stretch runs along y. */
  readonly narrow: boolean;
  readonly mark: { readonly width: number; readonly height: number };
  readonly obstacles: readonly FlowBox[];
}

/** The air a mark keeps from everything but its own line. */
export const MARK_AIR = 4;
/** A mark on a stretch stays this far off the stretch's corners. */
const CORNER_ROOM = 6;
/** How far apart the spots tried along a line are. */
const SLIDE_STEP = 4;
/** A mark that slides along the whole line stays this far off the line's ends. */
const END_ROOM = 12;

export function markSpots(
  lines: readonly MarkedLine[],
  room: MarkRoom,
  rule: MarkRule,
): readonly (Pt | undefined)[] {
  const placed: FlowBox[] = [];
  return lines.map((line, index) => {
    if (!line.marked) return undefined;
    const others = lines.filter((_, other) => other !== index);
    const free = (middle: Pt): boolean => {
      const box = grown(boxAround(middle, room.mark.width, room.mark.height), MARK_AIR);
      return (
        !room.obstacles.some((obstacle) => boxesOverlap(box, obstacle)) &&
        !placed.some((mark) => boxesOverlap(box, mark)) &&
        !others.some(({ points }) => lineHitsBox(points, box))
      );
    };
    const found = candidates(line.points, room, rule).find(free);
    if (found) placed.push(boxAround(found, room.mark.width, room.mark.height));
    return found;
  });
}

function candidates(points: readonly Pt[], room: MarkRoom, rule: MarkRule): readonly Pt[] {
  if (rule === "level-stretch") return stretchSpots(points, room);
  const length = lengthOf(points);
  const anchor = rule === "middle" ? length / 2 : longestStretchMiddle(points);
  return outward(anchor, END_ROOM, length - END_ROOM).map((at) => pointAlong(points, at));
}

/** The spots from `anchor` outward, nearest first, within the range. */
function outward(anchor: number, low: number, high: number): readonly number[] {
  if (low > high) return [];
  const from = Math.min(high, Math.max(low, anchor));
  const spots = [from];
  for (let step = SLIDE_STEP; from - step >= low || from + step <= high; step += SLIDE_STEP) {
    if (from - step >= low) spots.push(from - step);
    if (from + step <= high) spots.push(from + step);
  }
  return spots;
}

/** How far along the line the middle of its longest stretch is. */
function longestStretchMiddle(points: readonly Pt[]): number {
  let [best, longest, walked] = [0, -1, 0];
  for (let i = 1; i < points.length; i += 1) {
    const reach = distance(points[i - 1]!, points[i]!);
    if (reach > longest) [best, longest] = [walked + reach / 2, reach];
    walked += reach;
  }
  return best;
}

/** The spots on the line's level stretches, the longest stretch first, then on its upright ones. */
function stretchSpots(points: readonly Pt[], { narrow, mark }: MarkRoom): readonly Pt[] {
  const stretches = points.slice(1).map((to, index) => {
    const from = points[index]!;
    const alongX = Math.abs(to[1] - from[1]) < Math.abs(to[0] - from[0]);
    return { from, to, alongX, level: alongX !== narrow, reach: distance(from, to) };
  });
  const byLength = stretches.toSorted((a, b) => b.reach - a.reach);
  return [
    ...byLength.filter(({ level }) => level),
    ...byLength.filter(({ level }) => !level),
  ].flatMap(({ from, to, alongX, reach }) => {
    const ends = CORNER_ROOM + (alongX ? mark.width : mark.height) / 2;
    return outward(reach / 2, ends, reach - ends).map((at) => pointAlong([from, to], at));
  });
}
