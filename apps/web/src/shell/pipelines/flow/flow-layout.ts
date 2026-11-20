import type { Route, Stage, StagePlace } from "@the-office/contracts";
import type { FlowDrop } from "./flow-model.ts";
import type { FlowOverlay } from "./flow-marks.ts";

/**
 * The flow canvas's geometry (docs/design/pipeline-flow.html), apart from React: where each Stage
 * goes in the grid of places, and, from the boxes the canvas measured, the routes' and loops' lines
 * as SVG path data. Across, the columns run left to right in the Pipeline's order; down (a canvas
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

/** How a line looks: a route as it is, one a Proposal proposes or takes away, a removed Stage's. */
export type FlowLineLook = "plain" | "proposed" | "taken-away" | "ghost";

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
}

export interface FlowPath {
  readonly d: string;
  /** The arrow head's polygon points. */
  readonly arrow: string;
}

export interface FlowRoutePath extends FlowPath {
  readonly line: FlowLine;
}

export interface FlowLoopPath extends FlowPath {
  readonly fromKey: string;
  readonly toKey: string;
  readonly rounds: number;
  readonly lane: number;
  /** Where the ↺ N× mark sits, its middle. */
  readonly mark: FlowPoint;
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

/** Whether a Stage lists its routes inside it: more than one, or one with a condition. */
export function listsRoutes(stage: Stage): boolean {
  const routes = stage.routes ?? [];
  return routes.length > 1 || routes.some((route) => route.condition !== null);
}

/**
 * The lines to draw: each Stage's routes, a removed Stage's as ghosts, then a Proposal's proposed
 * and taken-away routes, which no press picks.
 */
export function flowLines(
  stages: readonly Stage[],
  removed: ReadonlySet<string>,
  overlay?: FlowOverlay,
): readonly FlowLine[] {
  const own = stages.flatMap((stage) => {
    const ghost = removed.has(stage.key);
    const lists = !ghost && listsRoutes(stage);
    return (stage.routes ?? []).map((route, index): FlowLine => ({
      id: `${stage.key}:${index}`,
      fromKey: stage.key,
      to: route.to,
      routeIndex: ghost ? undefined : index,
      port: lists ? index : undefined,
      look: ghost ? "ghost" : "plain",
    }));
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
    })),
  );
}

/**
 * Whether a line must go round rather than straight: it leads to its own or an earlier column, or
 * a Stage stands between on its row. A line to End never does, as End is after every column.
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
 * The On failure loops, each in a lane of its own above the Stages (beside them, down), so two
 * loops that overlap never share a line: the shortest get the lanes nearest the Stages.
 */
export function loopLanes(stages: readonly Stage[]): readonly LaidLoop[] {
  const loops = stages
    .flatMap((from): Loop[] => {
      if (from.kind === "gate" || !from.onFailure) return [];
      const to = stages.find(({ key }) => key === from.onFailure?.goBackTo);
      if (!to) return [];
      const a = placeOf(stages, from).column;
      const b = placeOf(stages, to).column;
      return [{ from, to, lo: Math.min(a, b), hi: Math.max(a, b) }];
    })
    .toSorted((a, b) => a.hi - a.lo - (b.hi - b.lo));
  const lanes: Loop[][] = [];
  return loops.map((loop) => {
    let lane = 0;
    while ((lanes[lane] ?? []).some((other) => !(other.hi <= loop.lo || other.lo >= loop.hi)))
      lane += 1;
    (lanes[lane] ??= []).push(loop);
    return { ...loop, lane };
  });
}

const LOOP_LANE = 11;
const LOOP_CLEARANCE = 12;
const DETOUR_LANE = 8;
const DETOUR_CLEARANCE = 12;

/** The room the canvas keeps for the loops' lanes and for the lines that go round, in px. */
export function flowRoom(
  stages: readonly Stage[],
  lines: readonly FlowLine[],
  loops: readonly LaidLoop[],
): { readonly loops: number; readonly detours: number } {
  const laneCount = loops.reduce((most, { lane }) => Math.max(most, lane + 1), 0);
  const detours = lines.filter((line) => lineDetours(stages, line)).length;
  return {
    loops: laneCount ? laneCount * LOOP_LANE + 14 : 0,
    detours: detours ? detours * DETOUR_LANE + 16 : 0,
  };
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

/** An arrow head's points, its tip at (x, y), pointing right or down. */
export function arrowHead(x: number, y: number, direction: "right" | "down"): string {
  return direction === "down"
    ? `${x},${y} ${x - 4},${y - 7} ${x + 4},${y - 7}`
    : `${x},${y} ${x - 7},${y - 4} ${x - 7},${y + 4}`;
}

const middleX = (box: FlowBox): number => box.x + box.width / 2;
const middleY = (box: FlowBox): number => box.y + box.height / 2;

/** The lines' paths, each from its port; lines that go round take a lane each, below or beside. */
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

function acrossPath(
  from: MeasuredStage,
  port: number | undefined,
  target: FlowBox,
  detourY: number | undefined,
): FlowPath {
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
  return { d: orthogonalPath(points), arrow: arrowHead(ex, ey, "right") };
}

function downPath(
  from: MeasuredStage,
  port: number | undefined,
  target: FlowBox,
  detourX: number | undefined,
): FlowPath {
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
  return { d: orthogonalPath(points), arrow: arrowHead(ex, ey, "down") };
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

/** The On failure loops' paths, dashed above the Stages (beside them, down), with their marks. */
export function loopPaths(
  loops: readonly LaidLoop[],
  measure: FlowMeasure,
  orientation: FlowOrientation,
): readonly FlowLoopPath[] {
  const outer = outerEdges(measure);
  return loops.flatMap((loop) => {
    const a = measure.stages.get(loop.from.key)?.box;
    const b = measure.stages.get(loop.to.key)?.box;
    if (!a || !b) return [];
    const facts = {
      fromKey: loop.from.key,
      toKey: loop.to.key,
      rounds: loop.from.kind === "gate" ? 0 : (loop.from.onFailure?.rounds ?? 0),
      lane: loop.lane,
    };
    if (orientation === "across") {
      const y = outer.top - LOOP_CLEARANCE - loop.lane * LOOP_LANE;
      const points: Pt[] = [
        [middleX(a) + 6, a.y],
        [middleX(a) + 6, y],
        [middleX(b) - 6, y],
        [middleX(b) - 6, b.y - 6],
      ];
      return [
        {
          ...facts,
          d: orthogonalPath(points),
          arrow: arrowHead(middleX(b) - 6, b.y, "down"),
          mark: { x: (middleX(a) + middleX(b)) / 2, y },
        },
      ];
    }
    const x = outer.left - LOOP_CLEARANCE - loop.lane * LOOP_LANE;
    const points: Pt[] = [
      [a.x, middleY(a) - 4],
      [x, middleY(a) - 4],
      [x, middleY(b) + 4],
      [b.x - 6, middleY(b) + 4],
    ];
    return [
      {
        ...facts,
        d: orthogonalPath(points),
        arrow: arrowHead(b.x, middleY(b) + 4, "right"),
        mark: { x, y: (middleY(a) + middleY(b)) / 2 },
      },
    ];
  });
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
