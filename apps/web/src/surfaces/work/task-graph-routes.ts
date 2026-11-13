/**
 * The Task graph's edges, routed square (docs/design/README.md, "The Initiative page: what it
 * proposes", point 2): straight out of the blocker, two rounded corners on a vertical in the column
 * gap, and straight into an arrowhead of its own, so the head always points along the line.
 */

/** A Task's box in the graph's own coordinates, and the column it stands in. */
export interface TaskBox {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly column: number;
}

/** "Must be Done first": an edge from the blocker to the Task waiting for it. */
export interface RouteEdge {
  readonly from: string;
  readonly to: string;
  readonly blockerDone: boolean;
  /** The blocker stands outside the Initiative. */
  readonly fromOutside: boolean;
}

export interface EdgeRoute {
  readonly key: string;
  /** The line, from the blocker's right edge to under the arrowhead's base. */
  readonly line: string;
  /** The arrowhead, a closed triangle whose tip stands off the waiting Task. */
  readonly head: string;
  readonly blockerDone: boolean;
  readonly fromOutside: boolean;
}

/** The numbers the build takes, in px. */
export const EDGE_ROUTING = {
  runOut: 6,
  runIn: 4,
  headLength: 8,
  headWidth: 8,
  tipGap: 2,
  radius: 6,
  portSpacing: 8,
  portInset: 12,
  bendSpacing: 4,
  laneSpacing: 4,
  clearance: 10,
  straighten: 8,
} as const;

interface Ends {
  readonly edge: RouteEdge;
  readonly from: TaskBox;
  readonly to: TaskBox;
}

interface Column {
  readonly left: number;
  readonly right: number;
  readonly boxes: readonly TaskBox[];
}

interface Lane {
  readonly column: number;
  readonly side: "level" | "above" | "below";
  readonly y: number;
}

interface Route {
  readonly ends: Ends;
  /** The heights it runs at: the blocker's port, a lane through each skipped column, the waiting Task's port. */
  readonly levels: readonly number[];
}

interface Bend {
  readonly route: Route;
  /** Which change of level it is: it stands in that many gaps after the blocker's column. */
  readonly transition: number;
  readonly y0: number;
  readonly y1: number;
}

/** The height an edge runs at next to one of its Tasks. */
type Height = (ends: Ends) => number;

/** Each edge whose two Tasks were measured, routed among all the others. */
export function routeEdges(
  boxes: ReadonlyMap<string, TaskBox>,
  edges: readonly RouteEdge[],
): EdgeRoute[] {
  const ends = edges.flatMap((edge) => {
    const from = boxes.get(edge.from);
    const to = boxes.get(edge.to);
    return from && to ? [{ edge, from, to }] : [];
  });
  const columns = columnsOf([...boxes.values()]);
  // Sketched from mid-height to mid-height first, to order the ports by where each edge heads.
  const sketch = lanesOf(
    ends,
    columns,
    ({ from }) => middle(from),
    ({ to }) => middle(to),
  );
  const { out, into } = portsOf(ends, sketch);
  const lanes = lanesOf(ends, columns, out, into);
  const routes = ends.map((each): Route => ({
    ends: each,
    levels: levelsOf(each, ends, out, lanes, into),
  }));
  const bendXs = bendPositions(routes, columns);
  return routes.map((route) => drawn(route, bendXs));
}

function middle(box: TaskBox): number {
  return (box.top + box.bottom) / 2;
}

function columnsOf(boxes: readonly TaskBox[]): Map<number, Column> {
  const columns = new Map<number, Column>();
  for (const box of boxes) {
    const column = columns.get(box.column);
    columns.set(
      box.column,
      column
        ? {
            left: Math.min(column.left, box.left),
            right: Math.max(column.right, box.right),
            boxes: [...column.boxes, box],
          }
        : { left: box.left, right: box.right, boxes: [box] },
    );
  }
  return columns;
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item]);
  return [...groups.values()];
}

// ---------- Lanes through skipped columns ----------

/** The heights each edge runs at through the columns it skips. */
function lanesOf(
  ends: readonly Ends[],
  columns: ReadonlyMap<number, Column>,
  start: Height,
  finish: Height,
): Map<Ends, number[]> {
  const raw = new Map(ends.map((each) => [each, rawLanes(each, columns, start, finish)]));
  const offsets = laneOffsets(ends, raw, start, finish);
  return new Map(
    ends.map((each) => [
      each,
      (raw.get(each) ?? []).map((lane) => lane.y + (offsets.get(lane) ?? 0)),
    ]),
  );
}

function rawLanes(
  each: Ends,
  columns: ReadonlyMap<number, Column>,
  start: Height,
  finish: Height,
): Lane[] {
  const lanes: Lane[] = [];
  let y = start(each);
  for (let column = each.from.column + 1; column < each.to.column; column++) {
    const lane = laneThrough(column, columns.get(column)?.boxes ?? [], y, finish(each));
    lanes.push(lane);
    y = lane.y;
  }
  return lanes;
}

/**
 * Where an edge crosses a column it skips: at its own height if that misses every Task there by
 * 10px, else just above or below the column, whichever is shorter. Never between two Tasks: their
 * 12px gap leaves a line 6px from each, and it reads as leaving the Task beside it.
 */
function laneThrough(column: number, boxes: readonly TaskBox[], y: number, target: number): Lane {
  const { clearance } = EDGE_ROUTING;
  if (!boxes.some(({ top, bottom }) => y > top - clearance && y < bottom + clearance)) {
    return { column, side: "level", y };
  }
  const above = Math.min(...boxes.map(({ top }) => top)) - clearance;
  const below = Math.max(...boxes.map(({ bottom }) => bottom)) + clearance;
  const cost = (candidate: number): number =>
    Math.abs(candidate - y) + Math.abs(candidate - target);
  return cost(above) <= cost(below)
    ? { column, side: "above", y: above }
    : { column, side: "below", y: below };
}

/**
 * Two lines in one lane stand 4px apart, outward; the outer one is the edge whose ends lie further
 * out, so the two don't cross where they bend into the lane.
 */
function laneOffsets(
  ends: readonly Ends[],
  raw: ReadonlyMap<Ends, readonly Lane[]>,
  start: Height,
  finish: Height,
): Map<Lane, number> {
  const uses = ends.flatMap((each) =>
    (raw.get(each) ?? [])
      .filter(({ side }) => side !== "level")
      .map((lane) => ({ lane, reach: (start(each) + finish(each)) / 2 })),
  );
  const offsets = new Map<Lane, number>();
  for (const group of groupBy(uses, ({ lane }) => `${lane.column}:${lane.side}`)) {
    const outward = group[0]?.lane.side === "above" ? -1 : 1;
    group
      .toSorted((first, second) => outward * (first.reach - second.reach))
      .forEach(({ lane }, order) => offsets.set(lane, outward * order * EDGE_ROUTING.laneSpacing));
  }
  return offsets;
}

// ---------- Ports ----------

/**
 * Several edges at one side of a Task spread 8px apart, centred on mid-height, ordered by the
 * height each runs at next to it so they don't cross, kept 12px inside the Task's corners.
 */
function portsOf(
  ends: readonly Ends[],
  sketch: ReadonlyMap<Ends, readonly number[]>,
): { out: Height; into: Height } {
  const out = new Map<Ends, number>();
  const into = new Map<Ends, number>();
  for (const group of groupBy(ends, ({ edge }) => edge.from)) {
    const heading = (each: Ends): number => sketch.get(each)?.[0] ?? middle(each.to);
    spreadPorts(group, ({ from }) => from, heading, out);
  }
  for (const group of groupBy(ends, ({ edge }) => edge.to)) {
    const coming = (each: Ends): number => sketch.get(each)?.at(-1) ?? middle(each.from);
    spreadPorts(group, ({ to }) => to, coming, into);
  }
  return {
    out: (each) => out.get(each) ?? middle(each.from),
    into: (each) => into.get(each) ?? middle(each.to),
  };
}

function spreadPorts(
  group: readonly Ends[],
  boxOf: (each: Ends) => TaskBox,
  nextHeight: Height,
  ports: Map<Ends, number>,
): void {
  const sorted = group.toSorted((first, second) => nextHeight(first) - nextHeight(second));
  sorted.forEach((each, order) => {
    const box = boxOf(each);
    ports.set(
      each,
      middle(box) + clamp(centred(order, sorted.length, EDGE_ROUTING.portSpacing), portReach(box)),
    );
  });
}

/** How far from mid-height a port may stand, 12px inside the Task's corners. */
function portReach(box: TaskBox): number {
  return Math.max(0, (box.bottom - box.top) / 2 - EDGE_ROUTING.portInset);
}

/** The offset of the `order`th of `count` things spaced `spacing` apart around a centre. */
function centred(order: number, count: number, spacing: number): number {
  return (order - (count - 1) / 2) * spacing;
}

function clamp(offset: number, reach: number): number {
  return Math.max(-reach, Math.min(reach, offset));
}

// ---------- Levels ----------

function levelsOf(
  each: Ends,
  ends: readonly Ends[],
  out: Height,
  lanes: ReadonlyMap<Ends, readonly number[]>,
  into: Height,
): number[] {
  const through = lanes.get(each) ?? [];
  const levels =
    through.length === 0
      ? straightened(each, ends, out(each), into(each))
      : [out(each), ...through, into(each)];
  // Less than a pixel apart is drawn level, as a bend that small would only blur the line.
  return levels.reduce<number[]>((kept, level) => {
    const last = kept.at(-1);
    kept.push(last !== undefined && Math.abs(level - last) < 1 ? last : level);
    return kept;
  }, []);
}

/**
 * Ends 8px apart or less make one straight line, no small S-bend: the end that is alone on its
 * side of its Task moves to meet the other; if neither is alone, it bends.
 */
function straightened(each: Ends, ends: readonly Ends[], start: number, finish: number): number[] {
  if (start === finish || Math.abs(finish - start) > EDGE_ROUTING.straighten)
    return [start, finish];
  const aloneInto = ends.filter(({ edge }) => edge.to === each.edge.to).length === 1;
  if (aloneInto && portFits(each.to, start)) return [start, start];
  const aloneOut = ends.filter(({ edge }) => edge.from === each.edge.from).length === 1;
  if (aloneOut && portFits(each.from, finish)) return [finish, finish];
  return [start, finish];
}

function portFits(box: TaskBox, y: number): boolean {
  return Math.abs(y - middle(box)) <= portReach(box);
}

// ---------- Bends ----------

/**
 * Each bend's vertical run, in the middle 12px of its gap (44 = 6 out + 6 corner + 12 + 6 corner
 * + 4 in + 8 head + 2 tip gap), the bends sharing a gap 4px apart so no two lie on one line.
 */
function bendPositions(
  routes: readonly Route[],
  columns: ReadonlyMap<number, Column>,
): Map<Route, number[]> {
  const xs = new Map(routes.map((route): [Route, number[]] => [route, []]));
  for (const bends of groupBy(bendsOf(routes), gapKey)) {
    const first = bends[0];
    if (!first) continue;
    const { centre, reach } = bendRoom(first, columns);
    bends.toSorted(uncrossed).forEach((bend, order) => {
      const x = centre + clamp(centred(order, bends.length, EDGE_ROUTING.bendSpacing), reach);
      const routeXs = xs.get(bend.route);
      if (routeXs) routeXs[bend.transition] = x;
    });
  }
  return xs;
}

function bendsOf(routes: readonly Route[]): Bend[] {
  return routes.flatMap((route) =>
    route.levels.slice(1).flatMap((y1, transition) => {
      const y0 = route.levels[transition] ?? y1;
      return y0 === y1 ? [] : [{ route, transition, y0, y1 }];
    }),
  );
}

function gapOf({ route, transition }: Bend): number {
  return route.ends.from.column + transition;
}

function gapKey(bend: Bend): string {
  return String(gapOf(bend));
}

function bendRoom(
  bend: Bend,
  columns: ReadonlyMap<number, Column>,
): { centre: number; reach: number } {
  const { runOut, runIn, radius, headLength, tipGap } = EDGE_ROUTING;
  const gap = gapOf(bend);
  const left = (columns.get(gap)?.right ?? bend.route.ends.from.right) + runOut + radius;
  const right =
    (columns.get(gap + 1)?.left ?? bend.route.ends.to.left) - tipGap - headLength - runIn - radius;
  return { centre: (left + right) / 2, reach: Math.max(0, (right - left) / 2) };
}

/**
 * Left to right so that bends overlapping in height don't cross: rising ones first, the higher
 * further left; then falling ones, the lower further left. A rising and a falling bend that overlap
 * cross whichever stands first.
 */
function uncrossed(first: Bend, second: Bend): number {
  const rising = (bend: Bend): number => Math.sign(bend.y1 - bend.y0);
  if (rising(first) !== rising(second)) return rising(first) - rising(second);
  const height = (bend: Bend): number => (bend.y0 + bend.y1) / 2;
  return rising(first) < 0 ? height(first) - height(second) : height(second) - height(first);
}

// ---------- Drawing ----------

function drawn(route: Route, bendXs: ReadonlyMap<Route, readonly number[]>): EdgeRoute {
  const { edge, from, to } = route.ends;
  const { tipGap, headLength, headWidth } = EDGE_ROUTING;
  const tip = to.left - tipGap;
  const base = tip - headLength;
  const y = route.levels.at(-1) ?? middle(to);
  const xs = bendXs.get(route) ?? [];
  const corners = route.levels
    .slice(1)
    .map((y1, transition) => bendPath(xs[transition] ?? base, route.levels[transition] ?? y1, y1));
  // The line runs a pixel under the head, so no seam shows between them.
  const line = `M${n(from.right)},${n(route.levels[0] ?? y)}${corners.join("")} L${n(base + 1)},${n(y)}`;
  const half = headWidth / 2;
  return {
    key: `${edge.from}>${edge.to}`,
    line,
    head: `M${n(base)},${n(y - half)} L${n(tip)},${n(y)} L${n(base)},${n(y + half)} Z`,
    blockerDone: edge.blockerDone,
    fromOutside: edge.fromOutside,
  };
}

/** Along y0 to the vertical at x, down or up it to y1 with two rounded corners. */
function bendPath(x: number, y0: number, y1: number): string {
  if (y0 === y1) return "";
  const sign = Math.sign(y1 - y0);
  const radius = Math.min(EDGE_ROUTING.radius, Math.abs(y1 - y0) / 2);
  const [turnIn, turnOut] = sign > 0 ? [1, 0] : [0, 1];
  return (
    ` L${n(x - radius)},${n(y0)} A${n(radius)},${n(radius)} 0 0 ${turnIn} ${n(x)},${n(y0 + sign * radius)}` +
    ` L${n(x)},${n(y1 - sign * radius)} A${n(radius)},${n(radius)} 0 0 ${turnOut} ${n(x + radius)},${n(y1)}`
  );
}

/** A coordinate to two decimals, so the paths stay short and the tests can read them. */
function n(value: number): string {
  return String(Math.round(value * 100) / 100);
}
