import type { DrawnRoute, DrawnRoutes, RouteDrawer, RouteScene } from "./route-drawer.ts";
import {
  endKey,
  type EndOrder,
  OUTWARD,
  OWN_LOOP,
  type RouteEnd,
  type RouteEnds,
  routeEnds,
  type Side,
} from "./route-ends.ts";
import {
  drawnRoutes,
  type FrameCard,
  type RouteFrame,
  routeFrame,
  routesById,
  unionOf,
} from "./route-frame.ts";
import {
  add,
  bottom,
  crossingsOf,
  distance,
  grown,
  lineHitsBox,
  type Pt,
  right,
  straightShape,
  stretchHitsBox,
  times,
} from "./route-geometry.ts";
import { MARK_AIR } from "./mark-spots.ts";
import { type PortTrack, portTrack, settleTracks, type Track, trackAxis } from "./track-grid.ts";
import {
  cheapestWay,
  cornersOf,
  DOWN,
  type Heading,
  isLevel,
  keepCorner,
  keepNode,
  LEFT,
  nodeAt,
  reversed,
  RIGHT,
  takeWay,
  type TrackGrid,
  trackGrid,
  UP,
} from "./track-router.ts";

/**
 * Right angles (docs/design/pipeline-route-drawing.html, "Right angles"): level and upright
 * stretches with rounded corners, around the Stages, with the lines that share a side or a corridor
 * standing apart. Our own router, the approach of libavoid and ELK: each line takes the cheapest
 * way over a grid of tracks, the shortest line first, and the tracks in use are then set apart.
 */
export const rightAngles: RouteDrawer = (scene, rough) =>
  rough && drawsRoughly(scene) ? roughly(scene, rough) : inFull(scene);

/** Up to this size every frame of a drag draws in full; measured in right-angles.test.ts. */
const FULL_DRAWING = { stages: 8, lines: 16 } as const;
/** A corridor offers at most this many places side by side, or one per line with fewer lines. */
const MOST_SLOTS = 5;
const CORNER_RADIUS = 6;
/** With no way over the tracks, a line's plain elbow runs this far straight out of each edge. */
const ELBOW_OUT = 12;
/** No line runs closer to a card than this, but into its own ends. */
const CARD_CLEAR = 4;
/** A mark on a stretch stays this far off the stretch's corners (mark-spots.ts). */
const MARK_CORNER_ROOM = 6;

const drawsRoughly = (scene: RouteScene): boolean =>
  scene.stages.size > FULL_DRAWING.stages || scene.lines.length > FULL_DRAWING.lines;

function inFull(scene: RouteScene): DrawnRoutes {
  const frame = routeFrame(scene);
  let ends = routeEnds(frame);
  let paths = laidPaths(frame, ends);
  // Once the ways are known, each side's ends are put in the order their lines come to it, and
  // the lines are routed again; that drawing is kept when fewer lines cross in it.
  const reordered = routeEnds(frame, orderOfArrival(ends, paths));
  if (!sameEnds(ends, reordered)) {
    const again = laidPaths(frame, reordered);
    if (crossingsIn(again) < crossingsIn(paths)) [ends, paths] = [reordered, again];
  }
  return drawnRoutes(
    frame,
    frame.lines.map((line, index) => ({
      line,
      shape: straightShape(paths[index]!, CORNER_RADIUS),
      fromPort: ends[index]!.fromPort,
    })),
    "level-stretch",
  );
}

/**
 * Where each end belongs among its side's ends, from the way its line was routed, so lines don't
 * cross next to the card: the lines that turn towards the side's start come first, the one that
 * turns nearest the card outermost, then the straight ones, then those that turn the other way.
 */
function orderOfArrival(ends: readonly RouteEnds[], paths: readonly (readonly Pt[])[]): EndOrder {
  const order = new Map<string, readonly [number, number]>();
  for (const [line, own] of ends.entries()) {
    const path = paths[line]!;
    if (own.own) continue;
    for (const role of ["from", "to"] as const) {
      const [edge, turn, beyond] = role === "from" ? path : path.toReversed();
      const along = levelSide(own[role].side) ? 0 : 1;
      const heads = turn && beyond ? Math.sign(beyond[along] - turn[along]) : 0;
      const out = turn && edge ? Math.abs(turn[1 - along]! - edge[1 - along]!) : 0;
      order.set(
        endKey(line, role),
        heads === 0 ? [1, edge?.[along] ?? 0] : [1 + heads, heads * -out],
      );
    }
  }
  return order;
}

const sameEnd = (one: RouteEnd, other: RouteEnd): boolean =>
  one.side === other.side && distance(one.point, other.point) < 0.01;

function sameEnds(a: readonly RouteEnds[], b: readonly RouteEnds[]): boolean {
  return a.every(
    (ends, line) => sameEnd(ends.from, b[line]!.from) && sameEnd(ends.to, b[line]!.to),
  );
}

function crossingsIn(paths: readonly (readonly Pt[])[]): number {
  let count = 0;
  for (const [index, path] of paths.entries())
    for (const other of paths.slice(index + 1)) count += crossingsOf(path, other);
  return count;
}

/**
 * While a Stage of a large Pipeline is dragged: only its own lines, and the lines its card now
 * stands on, are routed again; the others keep the paths of the last full drawing.
 */
function roughly(
  scene: RouteScene,
  { previous, moved }: Parameters<RouteDrawer>[1] & {},
): DrawnRoutes {
  const before = routesById(previous);
  const card = moved === null ? scene.end : scene.stages.get(moved)?.box;
  const keeps = (route: DrawnRoute | undefined): route is DrawnRoute =>
    route !== undefined &&
    route.line.fromKey !== moved &&
    route.line.to !== moved &&
    !(
      card &&
      lineHitsBox(
        route.points.map(({ x, y }): Pt => [x, y]),
        card,
      )
    );
  const again = scene.lines.filter((line) => !keeps(before.get(line.id)));
  const redrawn = inFull({ ...scene, lines: again });
  const now = routesById(redrawn);
  const routes = scene.lines.flatMap((line): DrawnRoute[] => {
    const route = now.get(line.id) ?? before.get(line.id);
    return route ? [{ ...route, line }] : [];
  });
  const bounds = [previous.bounds, redrawn.bounds].filter((box) => box !== undefined);
  return { routes, bounds: unionOf(bounds) };
}

/** One end of a line laid on the tracks: its card's edge, and the port's own track by its index. */
interface LaidEnd {
  readonly side: Side;
  readonly edge: number;
  readonly track: number;
}

/** A line laid on the tracks: its ends and the nodes it turns in, each as [column, row]. */
interface Laid {
  readonly from: LaidEnd;
  readonly to: LaidEnd;
  readonly corners: readonly (readonly [number, number])[];
}

const HEADING_OUT: Readonly<Record<Side, Heading>> = {
  right: RIGHT,
  bottom: DOWN,
  left: LEFT,
  top: UP,
};

/** Whether a side runs along x, so a line through it runs upright. */
const levelSide = (side: Side): boolean => side === "top" || side === "bottom";

/** Each line's way from edge to edge as its corner points, in the frame's lines' order. */
function laidPaths(frame: RouteFrame, ends: readonly RouteEnds[]): readonly (readonly Pt[])[] {
  const ports = frame.lines.flatMap((_, line) => portTracks(ends[line]!, line));
  const most = Math.min(frame.lines.length, MOST_SLOTS);
  const columns = trackAxis(
    frame.obstacles.flatMap((box) => [box.x, right(box)]),
    ports.filter(({ upright }) => upright),
    most,
  );
  const rows = trackAxis(
    frame.obstacles.flatMap((box) => [box.y, bottom(box)]),
    ports.filter(({ upright }) => !upright),
    most,
  );
  const grid = trackGrid(columns, rows, frame.obstacles);
  const laidEnd = ({ side, point }: RouteEnd): LaidEnd => ({
    side,
    edge: point[levelSide(side) ? 1 : 0],
    track: levelSide(side) ? portTrack(columns, point[0]) : portTrack(rows, point[1]),
  });
  const laid: (Laid | undefined)[] = frame.lines.map(() => undefined);
  const waiting: number[] = [];
  for (const [line, own] of ends.entries()) {
    const [start, end] = [laidEnd(own.from), laidEnd(own.to)];
    if (own.own)
      laid[line] = ownLoop(grid, line, start, end, portTrack(rows, ownLoopLevel(own.from)));
    else if (runsStraight(frame, grid, line, own, start, end))
      laid[line] = { from: start, to: end, corners: [] };
    else waiting.push(line);
  }
  // Every line's place next to its two edges is kept before any is routed, so no other line runs
  // along it there.
  const nextTo = new Map<number, { from: number | undefined; to: number | undefined }>();
  for (const line of waiting) {
    const { from, to } = frame.lines[line]!;
    const own = ends[line]!;
    const nodes = {
      from: nodeOutside(frame, grid, from, own.from, laidEnd(own.from).track),
      to: nodeOutside(frame, grid, to, own.to, laidEnd(own.to).track),
    };
    nextTo.set(line, nodes);
    if (nodes.from !== undefined) keepNode(grid, line, nodes.from, HEADING_OUT[own.from.side]);
    if (nodes.to !== undefined) keepNode(grid, line, nodes.to, HEADING_OUT[own.to.side]);
  }
  const span = (line: number): number => {
    const { from, to } = ends[line]!;
    return Math.abs(to.point[0] - from.point[0]) + Math.abs(to.point[1] - from.point[1]);
  };
  for (const line of waiting.toSorted((a, b) => span(a) - span(b) || a - b)) {
    const own = ends[line]!;
    const nodes = nextTo.get(line)!;
    if (nodes.from === undefined || nodes.to === undefined) continue;
    const start = { node: nodes.from, heading: HEADING_OUT[own.from.side] };
    const goal = { node: nodes.to, heading: reversed(HEADING_OUT[own.to.side]) };
    const way = cheapestWay(grid, line, start, goal);
    if (!way) continue;
    takeWay(grid, line, start, way);
    laid[line] = {
      from: laidEnd(own.from),
      to: laidEnd(own.to),
      corners: cornersOf(grid, start, way),
    };
  }
  for (const [line, own] of laid.entries())
    if (own && frame.lines[line]!.line.limit !== null) giveMarkRoom(frame, grid, own);
  settleTracks(columns);
  settleTracks(rows);
  return laid.map((own, line) => (own ? pointsOf(grid, own) : elbow(ends[line]!)));
}

interface LinePort extends PortTrack {
  /** Whether the port's track runs upright: the line leaves or enters a top or bottom edge. */
  readonly upright: boolean;
}

function portTracks(ends: RouteEnds, line: number): readonly LinePort[] {
  const ports = [ends.from, ends.to].map(({ side, point }): LinePort => {
    const upright = levelSide(side);
    return { line, upright, at: point[upright ? 0 : 1] };
  });
  if (!ends.own) return ports;
  return [...ports, { line, upright: false, at: ownLoopLevel(ends.from) }];
}

/** How far out a loop to its own Stage runs along its edge: a level track of its own. */
function ownLoopLevel({ side, point }: RouteEnd): number {
  return point[1] + OUTWARD[side][1] * OWN_LOOP.out;
}

/** A route to its own Stage: out of the edge, along it and back in, on tracks of its own. */
function ownLoop(grid: TrackGrid, line: number, from: LaidEnd, to: LaidEnd, level: number): Laid {
  const [low, high] = [Math.min(from.track, to.track), Math.max(from.track, to.track)];
  for (const [row, { at }] of grid.rows.entries()) {
    const between = from.side === "top" ? at < from.edge : at > from.edge;
    const within = from.side === "top" ? row > level : row < level;
    if (!between || !within) continue;
    keepNode(grid, line, nodeAt(grid, from.track, row), DOWN);
    keepNode(grid, line, nodeAt(grid, to.track, row), DOWN);
  }
  for (let column = low + 1; column < high; column += 1)
    keepNode(grid, line, nodeAt(grid, column, level), RIGHT);
  keepCorner(grid, line, nodeAt(grid, from.track, level));
  keepCorner(grid, line, nodeAt(grid, to.track, level));
  return {
    from,
    to,
    corners: [
      [from.track, level],
      [to.track, level],
    ],
  };
}

/**
 * Whether a line runs straight from edge to edge: its two ends face each other on one track, and
 * nothing stands or runs between them. It takes the nodes between when it does.
 */
function runsStraight(
  frame: RouteFrame,
  grid: TrackGrid,
  line: number,
  ends: RouteEnds,
  from: LaidEnd,
  to: LaidEnd,
): boolean {
  const out = OUTWARD[ends.from.side];
  const [a, b] = [ends.from.point, ends.to.point];
  const facing = OUTWARD[ends.to.side][0] === -out[0] && OUTWARD[ends.to.side][1] === -out[1];
  const ahead = (b[0] - a[0]) * out[0] + (b[1] - a[1]) * out[1] > 0;
  if (!facing || !ahead || from.track !== to.track) return false;
  const { from: source, to: target } = frame.lines[line]!;
  const others = frame.obstacles.filter((box) => box !== source.box && box !== target.box);
  if (others.some((box) => stretchHitsBox(a, b, grown(box, CARD_CLEAR)))) return false;
  const upright = levelSide(from.side);
  const across = upright ? grid.rows : grid.columns;
  const [low, high] = [Math.min(from.edge, to.edge), Math.max(from.edge, to.edge)];
  const nodes = across.flatMap(({ at }, index) =>
    at > low && at < high
      ? [upright ? nodeAt(grid, from.track, index) : nodeAt(grid, index, from.track)]
      : [],
  );
  const heading = HEADING_OUT[from.side];
  const use = isLevel(heading) ? grid.levelUse : grid.uprightUse;
  if (nodes.some((node) => use[node] !== -1 && use[node] !== line)) return false;
  for (const node of nodes) keepNode(grid, line, node, heading);
  return true;
}

/** The node next to a card's edge on the end's own track; undefined when a card stands before it. */
function nodeOutside(
  frame: RouteFrame,
  grid: TrackGrid,
  card: FrameCard,
  { side, point }: RouteEnd,
  own: number,
): number | undefined {
  const upright = levelSide(side);
  const across = upright ? grid.rows : grid.columns;
  const edge = point[upright ? 1 : 0];
  const outward = OUTWARD[side][upright ? 1 : 0];
  const index =
    outward > 0
      ? across.findIndex(({ at }) => at > edge)
      : across.findLastIndex(({ at }) => at < edge);
  if (index < 0 || own < 0) return undefined;
  const at: Pt = upright ? [point[0], across[index]!.at] : [across[index]!.at, point[1]];
  const stands = frame.obstacles.some(
    (box) => box !== card.box && stretchHitsBox(point, at, grown(box, CARD_CLEAR)),
  );
  if (stands) return undefined;
  return upright ? nodeAt(grid, own, index) : nodeAt(grid, index, own);
}

/** The line's stretches, each with the track it runs along, where the tracks stand now. */
function stretchesOf(
  grid: TrackGrid,
  laid: Laid,
): readonly { readonly from: Pt; readonly to: Pt; readonly track: Track }[] {
  const points = pointsOf(grid, laid);
  const endTrack = ({ side, track }: LaidEnd): Track =>
    (levelSide(side) ? grid.columns : grid.rows)[track]!;
  return points.slice(1).map((to, index) => {
    const [before, after] = [laid.corners[index - 1], laid.corners[index]];
    const track =
      before === undefined
        ? endTrack(laid.from)
        : after === undefined
          ? endTrack(laid.to)
          : before[0] === after[0]
            ? grid.columns[before[0]]!
            : grid.rows[before[1]]!;
    return { from: points[index]!, to, track };
  });
}

function pointsOf(grid: TrackGrid, { from, to, corners }: Laid): readonly Pt[] {
  const endPoint = ({ side, edge, track }: LaidEnd): Pt =>
    levelSide(side) ? [grid.columns[track]!.at, edge] : [edge, grid.rows[track]!.at];
  return [
    endPoint(from),
    ...corners.map(([column, row]): Pt => [grid.columns[column]!.at, grid.rows[row]!.at]),
    endPoint(to),
  ];
}

/**
 * The stretch a line's ≤N× mark will sit on (mark-spots.ts: a level one first, the longest that
 * fits it) asks its track for the room the mark takes beside the line, so the stretch next to it
 * stands clear of the mark.
 */
function giveMarkRoom(frame: RouteFrame, grid: TrackGrid, laid: Laid): void {
  const stretches = stretchesOf(grid, laid).map((stretch) => {
    const alongX = stretch.from[1] === stretch.to[1];
    return {
      ...stretch,
      level: alongX !== frame.narrow,
      reach: distance(stretch.from, stretch.to),
      along: alongX ? frame.mark.width : frame.mark.height,
      across: alongX ? frame.mark.height : frame.mark.width,
    };
  });
  const byLength = stretches.toSorted((a, b) => b.reach - a.reach);
  const carries = [
    ...byLength.filter(({ level }) => level),
    ...byLength.filter(({ level }) => !level),
  ].find(({ reach, along }) => reach >= along + 2 * MARK_CORNER_ROOM);
  if (carries) carries.track.need = Math.max(carries.track.need, carries.across / 2 + MARK_AIR);
}

/** A line with no way over the tracks: straight out of each edge, and one corner between. */
function elbow({ from, to }: RouteEnds): readonly Pt[] {
  const out = add(from.point, times(OUTWARD[from.side], ELBOW_OUT));
  const into = add(to.point, times(OUTWARD[to.side], ELBOW_OUT));
  const corner: Pt = levelSide(from.side) ? [out[0], into[1]] : [into[0], out[1]];
  return [from.point, out, corner, into, to.point];
}
