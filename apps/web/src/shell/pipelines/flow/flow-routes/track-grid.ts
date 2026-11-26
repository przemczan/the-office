/**
 * The tracks Right angles routes its lines over, along one axis (docs/design/pipeline-route-drawing.html,
 * "Finding the way" and "Keeping lines apart"). The cards' edges and the ports' own tracks cut the
 * axis into corridors, none with an edge inside it, so a line anywhere in a corridor passes the
 * same cards. Each corridor holds slots: places for the lines that run along it, side by side.
 * While the lines are routed a slot only says in what order they lie; once they all are, the slots
 * in use are set apart and centred in their corridor.
 */

export interface Track {
  /** Where it runs: fixed for a port's track; for a slot, where it is tried until `settleTracks`. */
  at: number;
  /** The lines that may run along a port's track, by their index; any line along a slot. */
  readonly owners: ReadonlySet<number> | undefined;
  /** The corridor a slot is in, by its index. */
  readonly corridor: number | undefined;
  /** How far off the corridor's middle a slot is tried, which a line weighs lightly against it. */
  readonly offMiddle: number;
  /** The room a line along it needs on each side for its ≤N× mark; 0 with none. */
  need: number;
  used: boolean;
}

interface Corridor {
  /** The edges it lies between; one of them is missing outside the outermost cards. */
  readonly low: number | undefined;
  readonly high: number | undefined;
  /** How many of its slots are in use. */
  lines: number;
}

export interface TrackAxis {
  readonly tracks: Track[];
  readonly corridors: readonly Corridor[];
}

/** A port's own track: where it runs, and the line it is for. */
export interface PortTrack {
  readonly at: number;
  readonly line: number;
}

/** Lines side by side stand this far apart, and this far off a card, where there is room. */
export const LINES_APART = 16;
/** A crowded corridor never brings its lines, or a line and a card, closer than this. */
const LEAST_APART = 6;
/** Places nearer than this are one place. */
const SAME = 0.5;

/** The axis's tracks in order: every port's own, and up to `most` slots in each corridor. */
export function trackAxis(
  edges: readonly number[],
  ports: readonly PortTrack[],
  most: number,
): TrackAxis {
  const cuts: { at: number; owners: Set<number> | undefined }[] = [];
  const marks = [
    ...edges.map((at) => ({ at, line: undefined })),
    ...ports.map(({ at, line }) => ({ at, line })),
  ].toSorted((a, b) => a.at - b.at);
  for (const { at, line } of marks) {
    const last = cuts.at(-1);
    const cut = last && at - last.at < SAME ? last : { at, owners: undefined };
    if (cut !== last) cuts.push(cut);
    if (line !== undefined) (cut.owners ??= new Set()).add(line);
  }
  const tracks: Track[] = [];
  const corridors: Corridor[] = [];
  const slots = (low: number | undefined, high: number | undefined): void => {
    const corridor = corridors.push({ low, high, lines: 0 }) - 1;
    for (const at of slotPlaces(low, high, most))
      tracks.push({
        at,
        owners: undefined,
        corridor,
        offMiddle: low === undefined || high === undefined ? 0 : Math.abs(at - (low + high) / 2),
        need: 0,
        used: false,
      });
  };
  for (const [index, cut] of cuts.entries()) {
    slots(cuts[index - 1]?.at, cut.at);
    if (cut.owners)
      tracks.push({
        at: cut.at,
        owners: cut.owners,
        corridor: undefined,
        offMiddle: 0,
        need: 0,
        used: false,
      });
  }
  const last = cuts.at(-1);
  if (last) slots(last.at, undefined);
  return { tracks, corridors };
}

/** Where a corridor's slots are tried: 16 apart round its middle, closer when it is narrow. */
function slotPlaces(low: number | undefined, high: number | undefined, most: number): number[] {
  if (low === undefined && high === undefined) return [];
  if (low === undefined || high === undefined) {
    const steps = Array.from({ length: most }, (_, index) => (index + 1) * LINES_APART);
    return high === undefined
      ? steps.map((step) => low! + step)
      : steps.toReversed().map((step) => high - step);
  }
  const room = high - low - 2 * LEAST_APART;
  if (room < 0) return [];
  const count = Math.min(most, Math.floor(room / LINES_APART) + 1);
  const gap = count > 1 ? Math.min(LINES_APART, room / (count - 1)) : 0;
  const first = (low + high) / 2 - (gap * (count - 1)) / 2;
  return Array.from({ length: count }, (_, index) => first + index * gap);
}

/** Marks a track as one a line runs along. */
export function useTrack({ corridors }: TrackAxis, track: Track): void {
  if (track.used) return;
  track.used = true;
  if (track.corridor !== undefined) corridors[track.corridor]!.lines += 1;
}

/** Whether one more line along this slot would bring its corridor's lines closer than 16. */
export function isCrowded({ corridors }: TrackAxis, track: Track): boolean {
  const corridor = track.corridor === undefined ? undefined : corridors[track.corridor];
  if (!corridor || track.used || corridor.lines === 0) return false;
  if (corridor.low === undefined || corridor.high === undefined) return false;
  return (corridor.lines + 2) * LINES_APART > corridor.high - corridor.low;
}

/** The port's own track at a place, by its index. */
export function portTrack({ tracks }: TrackAxis, at: number): number {
  return tracks.findIndex((track) => track.owners !== undefined && Math.abs(track.at - at) < SAME);
}

/**
 * Sets every slot in use where its line is drawn: a line alone runs down its corridor's middle,
 * several stand 16 apart round it (as far as a mark needs beside a line that carries one), and a
 * narrow corridor shrinks the gaps evenly, never under 6. Outside the outermost cards the lines
 * stand from the edge outward. Their order never changes, so neither does what crosses what.
 */
export function settleTracks({ tracks, corridors }: TrackAxis): void {
  for (const [index, { low, high }] of corridors.entries()) {
    const used = tracks.filter((track) => track.corridor === index && track.used);
    if (used.length === 0) continue;
    const gaps = used.slice(1).map((track, i) => Math.max(LINES_APART, track.need, used[i]!.need));
    const before = Math.max(LINES_APART, used[0]!.need);
    const after = Math.max(LINES_APART, used.at(-1)!.need);
    if (low === undefined || high === undefined) {
      // From the edge outward: the high side's lines in order, the low side's from the last back.
      const outward = high === undefined ? used : used.toReversed();
      const steps = high === undefined ? gaps : gaps.toReversed();
      let reach = high === undefined ? before : after;
      for (const [i, track] of outward.entries()) {
        track.at = high === undefined ? low! + reach : high - reach;
        reach += steps[i] ?? 0;
      }
      continue;
    }
    const wanted = before + gaps.reduce((sum, gap) => sum + gap, 0) + after;
    const shrink = Math.min(1, (high - low) / wanted);
    const kept = gaps.map((gap) => Math.max(LEAST_APART, gap * shrink));
    const span = kept.reduce((sum, gap) => sum + gap, 0);
    const middle = (low + high - span) / 2;
    let at = shrink < 1 ? middle : Math.max(low + before, Math.min(high - after - span, middle));
    for (const [i, track] of used.entries()) {
      track.at = at;
      at += kept[i] ?? 0;
    }
  }
}
