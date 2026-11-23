import type { Route, RouteLimit, Stage, StagePlace } from "@the-office/contracts";
import { type FlowDrop, isRouteBack, limitOf } from "./flow-model.ts";
import type { FlowOverlay } from "./flow-marks.ts";

/**
 * The flow canvas's geometry (docs/design/pipeline-flow.html), apart from React: where each Stage
 * goes in the grid of places, and, from the boxes the canvas measured, the routes' lines as SVG
 * path data: a route on runs to the right, a route back curves back above the Stages in a lane of
 * its own, and each with a limit carries its ≤N× mark. Across, the columns run left to right in the Pipeline's order; down (a canvas
 * under 560px wide) they become bands top to bottom, a column's rows side by side.
 */

export type FlowOrientation = "across" | "down";

export const NARROW_FLOW_WIDTH = 560;

/** A canvas not laid out yet (0 wide, as in a test) runs across, as most canvases do. */
export function orientationFor(width: number): FlowOrientation {
  return width > 0 && width < NARROW_FLOW_WIDTH ? "down" : "across";
}

export interface FlowPoint {
  readonly x: number;
  readonly y: number;
}

/** A box relative to the canvas's padding box, in px. */
export interface FlowBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface MeasuredStage {
  readonly box: FlowBox;
  /**
   * The middle of each route line listed in the card, in the routes' order, along the edge its
   * ports are on: y across, x down. Empty when the card lists no routes.
   */
  readonly rowCentres: readonly number[];
}

export interface FlowMeasure {
  readonly stages: ReadonlyMap<string, MeasuredStage>;
  readonly end: FlowBox | undefined;
}

/** How a line looks: a route as it is, or one a Proposal proposes or takes away. */
export type FlowLineLook = "plain" | "proposed" | "taken-away";

/** One line to draw from a Stage to a Stage or End. */
export interface FlowLine {
  readonly id: string;
  readonly fromKey: string;
  readonly to: string | null;
  /** The route of the Stage it draws, by its index, when a press on the line picks it. */
  readonly routeIndex: number | undefined;
  /** The route line in the card it leaves from, by its index; the card's edge's middle without. */
  readonly port: number | undefined;
  readonly look: FlowLineLook;
  /** Its limit, which its ≤N× mark shows; null for No limit. */
  readonly limit: RouteLimit;
}

export interface FlowPath {
  readonly d: string;
  /** The arrow head's polygon points. */
  readonly arrow: string;
}

export interface FlowRoutePath extends FlowPath {
  readonly line: FlowLine;
  /** Where its ≤N× mark sits, its middle, when it has a limit. */
  readonly mark: FlowPoint;
}

/** A route back's path, in its lane above the Stages (beside them, down). */
export interface FlowLoopPath extends FlowRoutePath {
  readonly lane: number;
}

export interface FlowStartPath extends FlowPath {
  readonly dot: FlowPoint;
}

export interface FlowGridSize {
  readonly columns: number;
  readonly rows: number;
}

export interface FlowGridCell {
  readonly gridColumn: string;
  readonly gridRow: string;
}

interface Loop {
  readonly from: Stage;
  readonly to: Stage;
  readonly routeIndex: number;
  readonly limit: RouteLimit;
  readonly lo: number;
  readonly hi: number;
}

export interface LaidLoop extends Loop {
  readonly lane: number;
}

/** A Stage's place, or for one with none (only before `asFlow`) a column of its own by its index. */
export function placeOf(stages: readonly Stage[], stage: Stage): StagePlace {
  return stage.place ?? { column: stages.indexOf(stage), row: 0 };
}

export function flowGridSize(stages: readonly Stage[]): FlowGridSize {
  const places = stages.map((stage) => placeOf(stages, stage));
  return {
    columns: Math.max(0, ...places.map(({ column }) => column)) + 1,
    rows: Math.max(0, ...places.map(({ row }) => row)) + 1,
  };
}

export function gridCellOf(place: StagePlace, orientation: FlowOrientation): FlowGridCell {
  const across = { gridColumn: String(place.column + 1), gridRow: String(place.row + 1) };
  return orientation === "across"
    ? across
    : { gridColumn: across.gridRow, gridRow: across.gridColumn };
}

/** End stands after the last column, the whole height of the rows (the whole width, down). */
export function endCellOf(size: FlowGridSize, orientation: FlowOrientation): FlowGridCell {
  const after = String(size.columns + 1);
  return orientation === "across"
    ? { gridColumn: after, gridRow: "1 / -1" }
    : { gridColumn: "1 / -1", gridRow: after };
}

/** Whether a Stage lists its routes inside it: more than one, or one with a condition or a limit. */
export function listsRoutes(stage: Stage, stages: readonly Stage[] = [stage]): boolean {
  const routes = stage.routes ?? [];
  return (
    routes.length > 1 ||
    routes.some((route) => route.condition !== null || limitOf(stages, stage.key, route) !== null)
  );
}

/**
 * The lines to draw on: each Stage's routes on, then a Proposal's proposed and taken-away routes,
 * which no press picks. The routes back are `loopLanes`'.
 */
export function flowLines(stages: readonly Stage[], overlay?: FlowOverlay): readonly FlowLine[] {
  const own = stages.flatMap((stage) => {
    const lists = listsRoutes(stage, stages);
    return (stage.routes ?? []).flatMap((route, index): FlowLine[] =>
      isRouteBack(stages, stage.key, route.to)
        ? []
        : [
            {
              id: `${stage.key}:${index}`,
              fromKey: stage.key,
              to: route.to,
              routeIndex: index,
              port: lists ? index : undefined,
              look: "plain",
              limit: limitOf(stages, stage.key, route),
            },
          ],
    );
  });
  return [
    ...own,
    ...overlayLines(overlay?.proposed, "proposed"),
    ...overlayLines(overlay?.takenAway, "taken-away"),
  ];
}

function overlayLines(
  routes: ReadonlyMap<string, readonly Route[]> | undefined,
  look: FlowLineLook,
): readonly FlowLine[] {
  return [...(routes ?? new Map<string, readonly Route[]>())].flatMap(([fromKey, list]) =>
    list.map((route, index): FlowLine => ({
      id: `${look}:${fromKey}:${index}`,
      fromKey,
      to: route.to,
      routeIndex: undefined,
      port: undefined,
      look,
      limit: route.limit ?? null,
    })),
  );
}

/**
 * Whether a line must go round rather than straight: it leads to its own or an earlier column (a
 * later row of its own column, or a Proposal's route back), or a Stage stands between on its row. A
 * line to End never does, as End is after every column.
 */
export function needsDetour(
  stages: readonly Stage[],
  from: Stage,
  target: Stage | undefined,
): boolean {
  if (!target) return false;
  const start = placeOf(stages, from);
  const end = placeOf(stages, target);
  if (end.column <= start.column) return true;
  return stages.some((other) => {
    if (other === from || other === target) return false;
    const place = placeOf(stages, other);
    return place.row === start.row && place.column > start.column && place.column < end.column;
  });
}

/**
 * The routes back, to their own Stage or an earlier one, each in a lane of its own above the Stages
 * (beside them, down), so two that overlap never share a line: the shortest get the lanes nearest
 * the Stages.
 */
export function loopLanes(stages: readonly Stage[]): readonly LaidLoop[] {
  const loops = stages
    .flatMap((from): Loop[] =>
      (from.routes ?? []).flatMap((route, routeIndex): Loop[] => {
        const to = stages.find(({ key }) => key === route.to);
        if (!to || !isRouteBack(stages, from.key, to.key)) return [];
        const a = placeOf(stages, from).column;
        const b = placeOf(stages, to).column;
        const limit = limitOf(stages, from.key, route);
        return [{ from, to, routeIndex, limit, lo: Math.min(a, b), hi: Math.max(a, b) }];
      }),
    )
    .toSorted((a, b) => a.hi - a.lo - (b.hi - b.lo));
  const lanes: Loop[][] = [];
  return loops.map((loop) => {
    let lane = 0;
    while ((lanes[lane] ?? []).some((other) => lanesClash(other, loop))) lane += 1;
    (lanes[lane] ??= []).push(loop);
    return { ...loop, lane };
  });
}

/**
 * Loops that only meet at a column share a lane, as their ends there take separate points; a loop
 * within one column runs over that column, so it can't share it.
 */
function lanesClash(a: Loop, b: Loop): boolean {
  if (a.lo === a.hi || b.lo === b.hi) return a.lo <= b.hi && b.lo <= a.hi;
  return a.lo < b.hi && b.lo < a.hi;
}

/** The ≤N× mark's size at --text-2xs, its border included (flow-canvas.css). */
const MARK_WIDTH = 40;
const MARK_HEIGHT = 18;
/** Parallel lines closer than this blur into one at the canvas's stroke. */
const LINE_GAP = 20;
/** Lanes a mark's height and some air apart, so a mark on one never touches the next. */
const LOOP_LANE = MARK_HEIGHT + 4;
/** The nearest lane stays off the cards by half a mark lying across it (down, its width). */
const LOOP_CLEARANCE = MARK_WIDTH / 2 + 4;
const DETOUR_LANE = LINE_GAP;
const DETOUR_CLEARANCE = 12;
/** A loop leaving a card's side does so this far below its top, a next one a step lower. */
const SIDE_INSET = 12;
const SIDE_STEP = 10;
/** The air a mark keeps from a line crossing its run, and the run's rounded corners. */
const MARK_AIR = 4;
const CORNER = 6;

/** The room the canvas keeps for the routes back's lanes and for the lines that go round, in px. */
export function flowRoom(
  stages: readonly Stage[],
  lines: readonly FlowLine[],
  loops: readonly LaidLoop[],
  orientation: FlowOrientation,
): { readonly loops: number; readonly detours: number } {
  const laneCount = loops.reduce((most, { lane }) => Math.max(most, lane + 1), 0);
  const detours = lines.filter((line) => lineDetours(stages, line)).length;
  return {
    loops: laneCount
      ? LOOP_CLEARANCE + (laneCount - 1) * LOOP_LANE + markHalf(orientation).across
      : 0,
    detours: detours ? DETOUR_CLEARANCE + detours * DETOUR_LANE : 0,
  };
}

interface MarkHalf {
  readonly along: number;
  readonly across: number;
}

/** Half a mark along its route's run and across it: across, the run is level; down, upright. */
function markHalf(orientation: FlowOrientation): MarkHalf {
  return orientation === "across"
    ? { along: MARK_WIDTH / 2, across: MARK_HEIGHT / 2 }
    : { along: MARK_HEIGHT / 2, across: MARK_WIDTH / 2 };
}

function lineDetours(stages: readonly Stage[], line: FlowLine): boolean {
  const from = stages.find(({ key }) => key === line.fromKey);
  const target = line.to === null ? undefined : stages.find(({ key }) => key === line.to);
  return from !== undefined && needsDetour(stages, from, target);
}

type Pt = readonly [number, number];

/** An orthogonal path through the points, its corners rounded. */
export function orthogonalPath(points: readonly Pt[], radius = 6): string {
  const pts = points.filter(
    (p, i) => i === 0 || p[0] !== points[i - 1]?.[0] || p[1] !== points[i - 1]?.[1],
  );
  const [first] = pts;
  if (!first) return "";
  let d = `M${first[0]},${first[1]}`;
  for (let i = 1; i < pts.length - 1; i += 1)
    d += ` ${corner(pts[i - 1]!, pts[i]!, pts[i + 1]!, radius)}`;
  const last = pts.at(-1)!;
  return pts.length > 1 ? `${d} L${last[0]},${last[1]}` : d;
}

function corner([px, py]: Pt, [x, y]: Pt, [nx, ny]: Pt, radius: number): string {
  const r = Math.min(radius, Math.hypot(x - px, y - py) / 2, Math.hypot(nx - x, ny - y) / 2);
  const ax = x - Math.sign(x - px) * r;
  const ay = y - Math.sign(y - py) * r;
  const bx = x + Math.sign(nx - x) * r;
  const by = y + Math.sign(ny - y) * r;
  return `L${ax},${ay} Q${x},${y} ${bx},${by}`;
}

type ArrowDirection = "right" | "down" | "left";

/** An arrow head's points, its tip at (x, y), pointing the way given. */
export function arrowHead(x: number, y: number, direction: ArrowDirection): string {
  return polygon(arrowPoints([x, y], direction));
}

function arrowPoints([x, y]: Pt, direction: ArrowDirection): readonly Pt[] {
  if (direction === "down")
    return [
      [x, y],
      [x - 4, y - 7],
      [x + 4, y - 7],
    ];
  const back = direction === "right" ? -7 : 7;
  return [
    [x, y],
    [x + back, y - 4],
    [x + back, y + 4],
  ];
}

const polygon = (points: readonly Pt[]): string => points.map(([x, y]) => `${x},${y}`).join(" ");

const middleX = (box: FlowBox): number => box.x + box.width / 2;
const middleY = (box: FlowBox): number => box.y + box.height / 2;

/**
 * The lines' paths, each from its port, with its mark in the middle of its longest stretch; lines
 * that go round take a lane each, below or beside.
 */
export function routePaths(
  stages: readonly Stage[],
  lines: readonly FlowLine[],
  measure: FlowMeasure,
  orientation: FlowOrientation,
): readonly FlowRoutePath[] {
  const outer = outerEdges(measure);
  let detour = 0;
  return lines.flatMap((line) => {
    const from = measure.stages.get(line.fromKey);
    const target = line.to === null ? measure.end : measure.stages.get(line.to)?.box;
    if (!from || !target) return [];
    const away = lineDetours(stages, line);
    const lane = away ? detour++ : 0;
    const path =
      orientation === "across"
        ? acrossPath(
            from,
            line.port,
            target,
            away ? outer.bottom + DETOUR_CLEARANCE + lane * DETOUR_LANE : undefined,
          )
        : downPath(
            from,
            line.port,
            target,
            away ? outer.right + DETOUR_CLEARANCE + lane * DETOUR_LANE : undefined,
          );
    return [{ line, ...path }];
  });
}

/** The middle of the longest stretch of an orthogonal line, where its mark sits. */
function longestMiddle(points: readonly Pt[]): FlowPoint {
  let best: readonly [Pt, Pt] = [points[0] ?? [0, 0], points[0] ?? [0, 0]];
  let length = -1;
  for (let i = 1; i < points.length; i += 1) {
    const [a, b] = [points[i - 1]!, points[i]!];
    const reach = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
    if (reach > length) [best, length] = [[a, b], reach];
  }
  return { x: (best[0][0] + best[1][0]) / 2, y: (best[0][1] + best[1][1]) / 2 };
}

function acrossPath(
  from: MeasuredStage,
  port: number | undefined,
  target: FlowBox,
  detourY: number | undefined,
): FlowPath & { readonly mark: FlowPoint } {
  const sx = from.box.x + from.box.width;
  const sy = (port === undefined ? undefined : from.rowCentres[port]) ?? middleY(from.box);
  const ex = target.x;
  const ey = middleY(target);
  const mx = ex - 14;
  const points: Pt[] =
    detourY !== undefined
      ? [
          [sx, sy],
          [sx + 10, sy],
          [sx + 10, detourY],
          [mx, detourY],
          [mx, ey],
          [ex - 6, ey],
        ]
      : Math.abs(sy - ey) < 1
        ? [
            [sx, sy],
            [ex - 6, ey],
          ]
        : [
            [sx, sy],
            [mx, sy],
            [mx, ey],
            [ex - 6, ey],
          ];
  return {
    d: orthogonalPath(points),
    arrow: arrowHead(ex, ey, "right"),
    mark: longestMiddle(points),
  };
}

function downPath(
  from: MeasuredStage,
  port: number | undefined,
  target: FlowBox,
  detourX: number | undefined,
): FlowPath & { readonly mark: FlowPoint } {
  const sx = downPortX(from, port);
  const sy = from.box.y + from.box.height;
  const ex = middleX(target);
  const ey = target.y;
  const my = ey - 14;
  const points: Pt[] =
    detourX !== undefined
      ? [
          [sx, sy],
          [sx, sy + 10],
          [detourX, sy + 10],
          [detourX, my],
          [ex, my],
          [ex, ey - 6],
        ]
      : Math.abs(sx - ex) < 1
        ? [
            [sx, sy],
            [ex, ey - 6],
          ]
        : [
            [sx, sy],
            [sx, my],
            [ex, my],
            [ex, ey - 6],
          ];
  return {
    d: orthogonalPath(points),
    arrow: arrowHead(ex, ey, "down"),
    mark: longestMiddle(points),
  };
}

/** Down, a card's route lines leave from its bottom edge, spread across it in their order. */
function downPortX({ box, rowCentres }: MeasuredStage, port: number | undefined): number {
  if (port === undefined || rowCentres.length < 2) return middleX(box);
  return box.x + (box.width * (port + 1)) / (rowCentres.length + 1);
}

/** The point a route being drawn from a Stage's + starts at. */
export function drawingStart(box: FlowBox, orientation: FlowOrientation): FlowPoint {
  return orientation === "across"
    ? { x: box.x + box.width, y: middleY(box) }
    : { x: middleX(box), y: box.y + box.height };
}

/**
 * The routes back's paths above the Stages (beside them, down), each with its mark on its run.
 * Worked out across; down is the same drawing with x and y swapped.
 */
export function loopPaths(
  loops: readonly LaidLoop[],
  measure: FlowMeasure,
  orientation: FlowOrientation,
): readonly FlowLoopPath[] {
  const swap = orientation === "down";
  const frame = swap ? swappedMeasure(measure) : measure;
  const laid = loops.flatMap((loop): DrawnLoop[] => {
    const leave = frame.stages.get(loop.from.key)?.box;
    const enter = frame.stages.get(loop.to.key)?.box;
    return leave && enter ? [{ loop, leave, enter }] : [];
  });
  const anchors = loopAnchors(laid, [
    ...[...frame.stages.values()].map(({ box }) => box),
    ...(frame.end ? [frame.end] : []),
  ]);
  const top = outerEdges(frame).top;
  const runs = laid.map(({ loop }, index): Run => {
    const legs = [anchors.get(endId(index, "leave"))!.leg, anchors.get(endId(index, "enter"))!.leg];
    return {
      y: top - LOOP_CLEARANCE - loop.lane * LOOP_LANE,
      from: Math.min(...legs),
      to: Math.max(...legs),
      lane: loop.lane,
      legs,
    };
  });
  const out = (point: Pt): Pt => (swap ? [point[1], point[0]] : point);
  const marks = markSpots(runs, markHalf(orientation));
  return laid.map(({ loop }, index) => {
    const run = runs[index]!;
    const leave = anchors.get(endId(index, "leave"))!;
    const enter = anchors.get(endId(index, "enter"))!;
    const points = [...legPoints(leave, run.y), ...legPoints(short(enter), run.y).toReversed()];
    const [x, y] = out([marks[index]!, run.y]);
    return {
      line: {
        id: `${loop.from.key}:${loop.routeIndex}`,
        fromKey: loop.from.key,
        to: loop.to.key,
        routeIndex: loop.routeIndex,
        port: undefined,
        look: "plain",
        limit: loop.limit,
      },
      lane: loop.lane,
      d: orthogonalPath(points.map(out)),
      arrow: polygon(arrowPoints(enter.edge, enter.into).map(out)),
      mark: { x, y },
    };
  });
}

interface DrawnLoop {
  readonly loop: LaidLoop;
  readonly leave: FlowBox;
  readonly enter: FlowBox;
}

type EndRole = "leave" | "enter";
type Side = "before" | "after";

/** One end of a loop on its card, and which way its other end lies. */
interface LoopEnd {
  readonly id: string;
  readonly box: FlowBox;
  readonly toward: Side;
  readonly lane: number;
}

/** Where a loop meets its card, and its leg from there up to its lane. */
interface Anchor {
  readonly edge: Pt;
  readonly leg: number;
  /** The way an arrow points into the card there. */
  readonly into: ArrowDirection;
}

/** A loop's level run along its lane, between its legs. */
interface Run {
  readonly y: number;
  readonly from: number;
  readonly to: number;
  readonly lane: number;
  readonly legs: readonly number[];
}

const endId = (index: number, role: EndRole): string => `${index}:${role}`;

const swapBox = ({ x, y, width, height }: FlowBox): FlowBox => ({
  x: y,
  y: x,
  width: height,
  height: width,
});

function swappedMeasure(measure: FlowMeasure): FlowMeasure {
  return {
    stages: new Map(
      [...measure.stages].map(([key, stage]) => [key, { ...stage, box: swapBox(stage.box) }]),
    ),
    end: measure.end && swapBox(measure.end),
  };
}

function loopEnds(laid: readonly DrawnLoop[]): readonly LoopEnd[] {
  return laid.flatMap(({ loop, leave, enter }, index) => [
    {
      id: endId(index, "leave"),
      box: leave,
      toward: towards(leave, enter, "after"),
      lane: loop.lane,
    },
    {
      id: endId(index, "enter"),
      box: enter,
      toward: towards(enter, leave, "before"),
      lane: loop.lane,
    },
  ]);
}

/** A loop within one column leaves on the right of its card and comes back in on the left. */
function towards(box: FlowBox, other: FlowBox, level: Side): Side {
  const gap = middleX(other) - middleX(box);
  return Math.abs(gap) < 1 ? level : gap < 0 ? "before" : "after";
}

/**
 * Each loop end's own point: spread across its card's top edge, or, for a card with another above
 * it, out of its side into the gutter beside it, so no leg runs through a card.
 */
function loopAnchors(laid: readonly DrawnLoop[], boxes: readonly FlowBox[]): Map<string, Anchor> {
  const ends = loopEnds(laid);
  const covered = ends.filter(({ box }) => hasCardAbove(box, boxes));
  const open = ends.filter((end) => !covered.includes(end));
  return new Map([...topAnchors(open), ...sideAnchors(covered, boxes)]);
}

function hasCardAbove(box: FlowBox, boxes: readonly FlowBox[]): boolean {
  return boxes.some(
    (other) =>
      other.y + other.height <= box.y &&
      other.x < box.x + box.width &&
      other.x + other.width > box.x,
  );
}

/**
 * Ends whose lines turn back (toward the earlier side) come first, the lower lanes outermost, so a
 * leg never crosses the run of a line beside it.
 */
function byTurn(a: LoopEnd, b: LoopEnd): number {
  if (a.toward !== b.toward) return a.toward === "before" ? -1 : 1;
  return a.toward === "before" ? a.lane - b.lane : b.lane - a.lane;
}

/** Spread n points evenly between lo and hi, none at either. */
const spread = (lo: number, hi: number, index: number, count: number): number =>
  lo + ((hi - lo) * (index + 1)) / (count + 1);

function topAnchors(ends: readonly LoopEnd[]): [string, Anchor][] {
  return [...groupBy(ends, ({ box }) => boxKey(box)).values()].flatMap((group) =>
    group.toSorted(byTurn).map((end, index, sorted): [string, Anchor] => {
      const x = spread(end.box.x, end.box.x + end.box.width, index, sorted.length);
      return [end.id, { edge: [x, end.box.y], leg: x, into: "down" }];
    }),
  );
}

interface SideEnd extends LoopEnd {
  readonly side: Side;
  readonly gutter: readonly [number, number];
}

/** Where a side end's line leaves its card: the card's edge on that side. */
const edgeX = (end: SideEnd): number =>
  end.side === "before" ? end.box.x : end.box.x + end.box.width;

/** Legs sharing a gutter take a place of their own across it; on one card's side, nearest first. */
function sideAnchors(ends: readonly LoopEnd[], boxes: readonly FlowBox[]): [string, Anchor][] {
  const placed = ends.map((end) => gutterOf(end, boxes));
  const legs = new Map(
    [...groupBy(placed, ({ gutter }) => gutter.join(":")).values()].flatMap((group) =>
      group
        .toSorted(byTurn)
        .map(
          (end, index, sorted) => [end.id, spread(...end.gutter, index, sorted.length)] as const,
        ),
    ),
  );
  const reach = (end: SideEnd): number => Math.abs(legs.get(end.id)! - edgeX(end));
  return [...groupBy(placed, (end) => `${boxKey(end.box)}:${end.side}`).values()].flatMap((group) =>
    group
      .toSorted((a, b) => reach(a) - reach(b))
      .map((end, index): [string, Anchor] => [
        end.id,
        {
          edge: [edgeX(end), end.box.y + SIDE_INSET + index * SIDE_STEP],
          leg: legs.get(end.id)!,
          into: end.side === "before" ? "right" : "left",
        },
      ]),
  );
}

/** The gap beside the card toward the loop's other end; the first column has none before it. */
function gutterOf(end: LoopEnd, boxes: readonly FlowBox[]): SideEnd {
  const right = end.box.x + end.box.width;
  const before = boxes.filter((box) => box.x + box.width <= end.box.x);
  if (end.toward === "before" && before.length > 0) {
    const lo = Math.max(...before.map((box) => box.x + box.width));
    return { ...end, side: "before", gutter: [lo, end.box.x] };
  }
  const after = boxes.filter((box) => box.x >= right).map(({ x }) => x);
  const hi = after.length > 0 ? Math.min(...after) : right + 2 * LINE_GAP;
  return { ...end, side: "after", gutter: [right, hi] };
}

const boxKey = ({ x, y }: FlowBox): string => `${x}:${y}`;

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

/** From where a loop meets its card to its lane, by the gutter when it leaves from a side. */
function legPoints({ edge, leg }: Anchor, laneY: number): Pt[] {
  return [edge, [leg, edge[1]], [leg, laneY]];
}

/** The line stops short of the card, where the arrow head takes over. */
function short(anchor: Anchor): Anchor {
  const [x, y] = anchor.edge;
  const edge: Pt =
    anchor.into === "down" ? [x, y - 6] : anchor.into === "right" ? [x - 6, y] : [x + 6, y];
  return { ...anchor, edge };
}

/** Where the legs of loops in higher lanes cross a run on their way up. */
function crossingsOf(run: Run, runs: readonly Run[]): number[] {
  return runs
    .filter((other) => other.lane > run.lane)
    .flatMap(({ legs }) => legs)
    .filter((x) => x > run.from && x < run.to);
}

/**
 * Each run's mark along it, lane by lane from the cards out, each clear of the crossings on its run
 * and of the marks already placed on lanes too near to pass beside (down, where a mark is wider
 * than the gap between lanes).
 */
function markSpots(runs: readonly Run[], half: MarkHalf): number[] {
  const spots = new Map<number, number>();
  const order = runs.map((_, index) => index).toSorted((a, b) => runs[a]!.lane - runs[b]!.lane);
  for (const index of order) {
    const run = runs[index]!;
    const near = [...spots]
      .filter(([other]) => Math.abs(runs[other]!.y - run.y) < 2 * half.across + MARK_AIR)
      .map(([, spot]) => spot);
    spots.set(index, markSpot(run, crossingsOf(run, runs), half.along, near));
  }
  return runs.map((_, index) => spots.get(index)!);
}

/**
 * Where along its run a mark sits, `half` its size along the run: the free spot nearest the
 * middle, clear of every crossing, of the `marks` beside it and of the corners; with none, the
 * middle of the widest stretch between crossings.
 */
export function markSpot(
  run: { readonly from: number; readonly to: number },
  crossings: readonly number[],
  half: number,
  marks: readonly number[] = [],
): number {
  const middle = (run.from + run.to) / 2;
  const reach = half + MARK_AIR;
  const apart = 2 * half + MARK_AIR;
  const blocked = [
    ...crossings.map((x): Pt => [x - reach, x + reach]),
    ...marks.map((x): Pt => [x - apart, x + apart]),
  ];
  const free = freeStretches(run.from + CORNER + half, run.to - CORNER - half, blocked);
  const nearest = free
    .map(([lo, hi]) => Math.min(hi, Math.max(lo, middle)))
    .toSorted((a, b) => Math.abs(a - middle) - Math.abs(b - middle))[0];
  return nearest ?? widestMiddle(run.from, run.to, crossings);
}

function freeStretches(lo: number, hi: number, blocked: readonly Pt[]): Pt[] {
  const free: Pt[] = [];
  let start = lo;
  for (const [a, b] of blocked.toSorted((p, q) => p[0] - q[0])) {
    if (a > start) free.push([start, Math.min(a, hi)]);
    start = Math.max(start, b);
  }
  if (start <= hi) free.push([start, hi]);
  return free.filter(([a, b]) => a <= b);
}

function widestMiddle(from: number, to: number, crossings: readonly number[]): number {
  const stops = [from, ...crossings.toSorted((a, b) => a - b), to];
  let best: Pt = [from, to];
  let width = -1;
  for (let i = 1; i < stops.length; i += 1) {
    const gap = stops[i]! - stops[i - 1]!;
    if (gap > width) [best, width] = [[stops[i - 1]!, stops[i]!], gap];
  }
  return (best[0] + best[1]) / 2;
}

/** Where the walk starts: a dot and a short line into the first Stage. */
export function startPath(
  first: Stage | undefined,
  measure: FlowMeasure,
  orientation: FlowOrientation,
): FlowStartPath | undefined {
  const box = first ? measure.stages.get(first.key)?.box : undefined;
  if (!box) return undefined;
  if (orientation === "across") {
    const y = middleY(box);
    return {
      dot: { x: box.x - 24, y },
      d: `M${box.x - 20},${y} L${box.x - 6},${y}`,
      arrow: arrowHead(box.x, y, "right"),
    };
  }
  const x = middleX(box);
  return {
    dot: { x, y: box.y - 24 },
    d: `M${x},${box.y - 20} L${x},${box.y - 6}`,
    arrow: arrowHead(x, box.y, "down"),
  };
}

function outerEdges(measure: FlowMeasure): {
  top: number;
  left: number;
  bottom: number;
  right: number;
} {
  const boxes = [
    ...[...measure.stages.values()].map(({ box }) => box),
    ...(measure.end ? [measure.end] : []),
  ];
  if (boxes.length === 0) return { top: 0, left: 0, bottom: 0, right: 0 };
  return {
    top: Math.min(...boxes.map(({ y }) => y)),
    left: Math.min(...boxes.map(({ x }) => x)),
    bottom: Math.max(...boxes.map(({ y, height }) => y + height)),
    right: Math.max(...boxes.map(({ x, width }) => x + width)),
  };
}

/** The grid's tracks as laid out, in px, End's track last. */
export interface FlowTracks {
  readonly columns: readonly number[];
  readonly rows: readonly number[];
  readonly columnGap: number;
  readonly rowGap: number;
}

export interface FlowDropAt {
  readonly drop: FlowDrop;
  /** Where to show it, relative to the grid: a cell, or a thin bar in a gap for a new column. */
  readonly ghost: FlowBox;
}

interface Slot {
  readonly index: number;
  readonly newColumn: boolean;
  readonly start: number;
  readonly size: number;
}

/**
 * Where a Stage dragged to `point` (relative to the grid) would drop: the column under it, or a new
 * one when it is near a column's edge or past the last, and the row under it.
 */
export function dropAt(
  tracks: FlowTracks,
  point: FlowPoint,
  orientation: FlowOrientation,
): FlowDropAt {
  const down = orientation === "down";
  const major = majorSlot(
    (down ? tracks.rows : tracks.columns).slice(0, -1),
    down ? tracks.rowGap : tracks.columnGap,
    down ? point.y : point.x,
  );
  const minor = minorSlot(
    down ? tracks.columns : tracks.rows,
    down ? tracks.columnGap : tracks.rowGap,
    down ? point.x : point.y,
  );
  const crossSize = sum(
    down ? tracks.columns : tracks.rows,
    down ? tracks.columnGap : tracks.rowGap,
  );
  const ghost: FlowBox = major.newColumn
    ? down
      ? { x: 0, y: major.start - 3, width: crossSize, height: 6 }
      : { x: major.start - 3, y: 0, width: 6, height: crossSize }
    : down
      ? { x: minor.start, y: major.start, width: minor.size, height: major.size }
      : { x: major.start, y: minor.start, width: major.size, height: minor.size };
  return { drop: { column: major.index, row: minor.index, newColumn: major.newColumn }, ghost };
}

function majorSlot(sizes: readonly number[], gap: number, at: number): Slot {
  let start = 0;
  for (const [index, size] of sizes.entries()) {
    if (at < start + size * 0.2) return { index, newColumn: true, start: start - gap / 2, size: 0 };
    if (at <= start + size * 0.8) return { index, newColumn: false, start, size };
    start += size + gap;
  }
  return { index: sizes.length, newColumn: true, start: start - gap / 2, size: 0 };
}

function minorSlot(sizes: readonly number[], gap: number, at: number): Slot {
  let start = 0;
  for (const [index, size] of sizes.entries()) {
    if (at <= start + size + gap / 2) return { index, newColumn: false, start, size };
    start += size + gap;
  }
  return { index: sizes.length, newColumn: false, start, size: sizes[0] ?? 60 };
}

function sum(sizes: readonly number[], gap: number): number {
  return sizes.reduce((total, size) => total + size, 0) + gap * Math.max(0, sizes.length - 1);
}
