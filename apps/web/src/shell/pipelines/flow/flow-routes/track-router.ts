import type { FlowBox } from "../flow-layout.ts";
import { bottom, grown, right } from "./route-geometry.ts";
import { isCrowded, type Track, type TrackAxis, useTrack } from "./track-grid.ts";

/**
 * Right angles' search (docs/design/pipeline-route-drawing.html, "Finding the way"): the upright
 * tracks (columns) and the level ones (rows) cross in nodes, and a line takes the cheapest way from
 * node to node: its length, plus 48 for each bend, plus 192 for each crossing of a line already
 * there. A node holds at most one line each way, and a line turns only in a node nobody else is in,
 * so lines cross at right angles and never share a stretch.
 */

/** The way a line runs: right, down, left or up. */
export type Heading = 0 | 1 | 2 | 3;

export const RIGHT: Heading = 0;
export const DOWN: Heading = 1;
export const LEFT: Heading = 2;
export const UP: Heading = 3;

export const isLevel = (heading: Heading): boolean => heading % 2 === 0;
export const reversed = (heading: Heading): Heading => ((heading + 2) % 4) as Heading;

const BEND_COST = 48;
const CROSSING_COST = 192;
/** Turning into a corridor whose lines would stand closer than 16 costs this, so a roomier way wins. */
const CROWDED_COST = 96;
/** A line weighs a slot's distance off its corridor's middle this lightly, only to break ties. */
const OFF_MIDDLE_COST = 0.01;
/** No line runs closer to a card than this, but into its own ends. */
const CARD_CLEAR = 4;
const NOBODY = -1;

export interface TrackGrid {
  readonly columnAxis: TrackAxis;
  readonly rowAxis: TrackAxis;
  readonly columns: readonly Track[];
  readonly rows: readonly Track[];
  /** Whether a card stands on the stretch from a node to the next one right of it, or under it. */
  readonly blockedRight: Uint8Array;
  readonly blockedDown: Uint8Array;
  /** The line running level, or upright, through each node, by its index. */
  readonly levelUse: Int16Array;
  readonly uprightUse: Int16Array;
  /** The search's notes, one per node and heading and a last one for having arrived, kept between lines. */
  readonly search: {
    readonly cost: Float64Array;
    readonly cameFrom: Int32Array;
    /** The search that last reached each state, and the one that settled it. */
    readonly reachedIn: Int32Array;
    readonly settledIn: Int32Array;
    searches: number;
  };
}

export function trackGrid(
  columns: TrackAxis,
  rows: TrackAxis,
  obstacles: readonly FlowBox[],
): TrackGrid {
  const size = columns.tracks.length * rows.tracks.length;
  const grid: TrackGrid = {
    columnAxis: columns,
    rowAxis: rows,
    columns: columns.tracks,
    rows: rows.tracks,
    blockedRight: new Uint8Array(size),
    blockedDown: new Uint8Array(size),
    levelUse: new Int16Array(size).fill(NOBODY),
    uprightUse: new Int16Array(size).fill(NOBODY),
    search: {
      cost: new Float64Array(size * 4 + 1),
      cameFrom: new Int32Array(size * 4 + 1),
      reachedIn: new Int32Array(size * 4 + 1),
      settledIn: new Int32Array(size * 4 + 1),
      searches: 0,
    },
  };
  for (const obstacle of obstacles) block(grid, grown(obstacle, CARD_CLEAR));
  return grid;
}

/** The tracks inside a span, by their index. */
const tracksInside = (tracks: readonly Track[], low: number, high: number): readonly number[] =>
  tracks.flatMap(({ at }, index) => (at > low && at < high ? [index] : []));

/** The tracks from which the stretch to the next track reaches into a span, by their index. */
const stretchesInto = (tracks: readonly Track[], low: number, high: number): readonly number[] =>
  tracks.flatMap(({ at }, index) => {
    const next = tracks[index + 1]?.at;
    return next !== undefined && at < high && next > low ? [index] : [];
  });

function block(grid: TrackGrid, box: FlowBox): void {
  const { columns, rows } = grid;
  for (const row of tracksInside(rows, box.y, bottom(box)))
    for (const column of stretchesInto(columns, box.x, right(box)))
      grid.blockedRight[nodeAt(grid, column, row)] = 1;
  for (const column of tracksInside(columns, box.x, right(box)))
    for (const row of stretchesInto(rows, box.y, bottom(box)))
      grid.blockedDown[nodeAt(grid, column, row)] = 1;
}

export const nodeAt = (grid: TrackGrid, column: number, row: number): number =>
  row * grid.columns.length + column;

export const columnOf = (grid: TrackGrid, node: number): number => node % grid.columns.length;
export const rowOf = (grid: TrackGrid, node: number): number =>
  Math.floor(node / grid.columns.length);

const mayRun = (track: Track, line: number): boolean =>
  track.owners === undefined || track.owners.has(line);

const takenByAnother = (use: number | undefined, line: number): boolean =>
  use !== undefined && use !== NOBODY && use !== line;

/** Whether another line already runs through the node the way this one would. */
function runsThere(grid: TrackGrid, node: number, heading: Heading, line: number): boolean {
  return takenByAnother((isLevel(heading) ? grid.levelUse : grid.uprightUse)[node], line);
}

/** One end of a way: the node next to the card's edge, and the way the line runs through it. */
export interface WayEnd {
  readonly node: number;
  readonly heading: Heading;
}

/** A way over the grid: every node it passes, and the way it leaves each. */
export interface Way {
  readonly nodes: readonly number[];
  readonly headings: readonly Heading[];
}

/** Keeps a node for a line running through it, before the line's way is known. */
export function keepNode(grid: TrackGrid, line: number, node: number, heading: Heading): void {
  const use = isLevel(heading) ? grid.levelUse : grid.uprightUse;
  if (use[node] === NOBODY) use[node] = line;
}

/** Keeps a node for a line that turns in it. */
export function keepCorner(grid: TrackGrid, line: number, node: number): void {
  grid.levelUse[node] = line;
  grid.uprightUse[node] = line;
}

/** Writes a line's way into the grid, and marks the tracks it runs along as used. */
export function takeWay(grid: TrackGrid, line: number, from: WayEnd, way: Way): void {
  for (const [index, node] of way.nodes.entries()) {
    const into = index === 0 ? from.heading : way.headings[index - 1]!;
    const out = way.headings[index]!;
    if (into === out) keepNode(grid, line, node, out);
    else keepCorner(grid, line, node);
    for (const heading of [into, out])
      useTrack(isLevel(heading) ? grid.rowAxis : grid.columnAxis, trackAlong(grid, node, heading));
  }
}

export function trackAlong(grid: TrackGrid, node: number, heading: Heading): Track {
  return isLevel(heading) ? grid.rows[rowOf(grid, node)]! : grid.columns[columnOf(grid, node)]!;
}

/** The nodes of a way where the line turns, as [column, row]. */
export function cornersOf(
  grid: TrackGrid,
  from: WayEnd,
  way: Way,
): readonly (readonly [number, number])[] {
  return way.nodes.flatMap((node, index) => {
    const into = index === 0 ? from.heading : way.headings[index - 1]!;
    return into === way.headings[index] ? [] : [[columnOf(grid, node), rowOf(grid, node)] as const];
  });
}

/**
 * The cheapest way for a line from one end to the other (A* over node and heading), or undefined
 * when there is none: every way is closed by cards or by the lines already drawn.
 */
export function cheapestWay(
  grid: TrackGrid,
  line: number,
  from: WayEnd,
  to: WayEnd,
): Way | undefined {
  if (runsThere(grid, from.node, from.heading, line)) return undefined;
  const { columns, rows, levelUse, uprightUse, blockedRight, blockedDown } = grid;
  const width = columns.length;
  const height = rows.length;
  const arrived = width * height * 4;
  const { cost, cameFrom, reachedIn, settledIn } = grid.search;
  grid.search.searches += 1;
  const search = grid.search.searches;
  const goalX = columns[to.node % width]!.at;
  const goalY = rows[Math.floor(to.node / width)]!.at;
  const open = new CostHeap();
  const first = from.node * 4 + from.heading;
  cost[first] = 0;
  cameFrom[first] = -1;
  reachedIn[first] = search;
  open.push(0, first);
  for (let state = open.pop(); state !== -1; state = open.pop()) {
    if (settledIn[state] === search) continue;
    settledIn[state] = search;
    if (state === arrived) return wayTo(cameFrom, arrived, to.heading);
    const node = state >> 2;
    const heading = state & 3;
    const column = node % width;
    const row = (node - column) / width;
    const level = levelUse[node]!;
    const upright = uprightUse[node]!;
    const free = (level === NOBODY || level === line) && (upright === NOBODY || upright === line);
    for (let turn = 0; turn < 4; turn += 1) {
      if (turn === 2) continue;
      const next = (heading + turn) & 3;
      const alongRow = (next & 1) === 0;
      let total = cost[state]!;
      if (turn !== 0) {
        const onto = alongRow ? rows[row]! : columns[column]!;
        if (!free || !mayRun(onto, line)) continue;
        total += BEND_COST + OFF_MIDDLE_COST * onto.offMiddle;
        if (isCrowded(alongRow ? grid.rowAxis : grid.columnAxis, onto)) total += CROWDED_COST;
      } else {
        const across = alongRow ? upright : level;
        if (across !== NOBODY && across !== line) total += CROSSING_COST;
      }
      let reached = -1;
      let left = 0;
      if (node === to.node && next === to.heading) {
        reached = arrived;
      } else {
        const toColumn = column + (next === 0 ? 1 : next === 2 ? -1 : 0);
        const toRow = row + (next === 1 ? 1 : next === 3 ? -1 : 0);
        if (toColumn < 0 || toRow < 0 || toColumn >= width || toRow >= height) continue;
        const beyond = toRow * width + toColumn;
        const lower = beyond < node ? beyond : node;
        if (alongRow ? blockedRight[lower] : blockedDown[lower]) continue;
        const use = alongRow ? levelUse[beyond]! : uprightUse[beyond]!;
        if (use !== NOBODY && use !== line) continue;
        const x = columns[toColumn]!.at;
        const y = rows[toRow]!.at;
        total += Math.abs(x - columns[column]!.at) + Math.abs(y - rows[row]!.at);
        left = Math.abs(goalX - x) + Math.abs(goalY - y);
        reached = beyond * 4 + next;
      }
      if (reachedIn[reached] === search && total >= cost[reached]!) continue;
      reachedIn[reached] = search;
      cost[reached] = total;
      cameFrom[reached] = state;
      open.push(total + left, reached);
    }
  }
  return undefined;
}

function wayTo(cameFrom: Int32Array, arrived: number, last: Heading): Way {
  const nodes: number[] = [];
  const headings: Heading[] = [];
  let leaves = last;
  for (let state = cameFrom[arrived]!; state !== -1; state = cameFrom[state]!) {
    nodes.push(state >> 2);
    headings.push(leaves);
    leaves = (state & 3) as Heading;
  }
  return { nodes: nodes.toReversed(), headings: headings.toReversed() };
}

/** The states still to weigh, the cheapest first; among equals, the one put in last, which is furthest on. */
class CostHeap {
  private readonly costs: number[] = [];
  private readonly states: number[] = [];

  push(cost: number, state: number): void {
    const { costs, states } = this;
    let at = costs.length;
    costs.push(cost);
    states.push(state);
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (costs[parent]! < cost) break;
      costs[at] = costs[parent]!;
      states[at] = states[parent]!;
      at = parent;
    }
    costs[at] = cost;
    states[at] = state;
  }

  /** The cheapest state, taken out; -1 with none left. */
  pop(): number {
    const { costs, states } = this;
    if (costs.length === 0) return -1;
    const top = states[0]!;
    const cost = costs.pop()!;
    const state = states.pop()!;
    const size = costs.length;
    if (size === 0) return top;
    let at = 0;
    for (;;) {
      let child = 2 * at + 1;
      if (child >= size) break;
      if (child + 1 < size && costs[child + 1]! < costs[child]!) child += 1;
      if (costs[child]! >= cost) break;
      costs[at] = costs[child]!;
      states[at] = states[child]!;
      at = child;
    }
    costs[at] = cost;
    states[at] = state;
    return top;
  }
}
