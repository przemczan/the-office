import type { Route, Stage, StagePosition } from "@the-office/contracts";
import type { FlowBox, FlowPoint } from "./flow-layout.ts";
import type { FlowSize } from "./flow-zoom.ts";

/**
 * Where Stages stand on the flow canvas and how a dragged one snaps
 * (docs/design/pipeline-free-placement.html, "Moving and snapping"), apart from React. Positions
 * are canvas units, a CSS pixel at 100%, of a card's top-left corner. The numbers match the
 * service's (apps/service/src/modules/pipelines/domain/positions.ts).
 */

/** A Stage's card is this wide on the canvas. */
export const CARD_WIDTH = 232;
/** Between two Stages side by side: room for a route's line and its limit mark. */
export const STAGE_GAP = 76;
/** The snapping grid, and the step Shift + an arrow moves a Stage by. */
export const GRID_STEP = 16;
/** End's circle, across. */
export const END_SIZE = 44;
/** How near a Stage's line must be to snap to it, in screen pixels. */
export const SNAP_REACH = 8;
/** A dropped card never comes nearer another card than this. */
export const CLEARANCE = 16;

const CARD_HEIGHT = 72;
const LISTING_CARD_HEIGHT = 82;
const ROUTE_ROW_HEIGHT = 22;

/** A card on the canvas: a Stage by its key, or End (null), and its box in canvas units. */
export interface FlowCard {
  readonly key: string | null;
  readonly box: FlowBox;
}

/** A dashed guide through a matched line: across x at `at` (upright), or across y (level). */
export interface FlowGuide {
  readonly axis: "x" | "y";
  readonly at: number;
  /** Where it runs along the other axis. */
  readonly from: number;
  readonly to: number;
}

export interface SnappedMove {
  readonly position: StagePosition;
  readonly guides: readonly FlowGuide[];
}

export interface SnapOptions {
  /** The view's zoom: the reach is 8 screen pixels. */
  readonly zoom: number;
  /** Alt held: no grid, no guides, whole units only. */
  readonly free: boolean;
  /** Shift held: where the drag started, so the card keeps its row or its column. */
  readonly along?: StagePosition | undefined;
}

/**
 * Where a card dragged to `raw` lands as the pointer moves: each axis on its own, to the nearest
 * line of another card within reach (left, centre or right edge on x; top, centre or bottom on y),
 * else to the grid. Each matched line gets its guide.
 */
export function snapMove(
  raw: FlowPoint,
  size: FlowSize,
  others: readonly FlowBox[],
  { zoom, free, along }: SnapOptions,
): SnappedMove {
  const kept = along ? keptAxis(raw, along) : undefined;
  const point =
    kept === "x" ? { ...raw, y: along!.y } : kept === "y" ? { ...raw, x: along!.x } : raw;
  if (free) return { position: whole(point), guides: [] };
  const reach = SNAP_REACH / zoom;
  const x =
    kept === "y"
      ? { value: point.x }
      : snapAxis(
          point.x,
          size.width,
          others.map(({ x: at, width }) => [at, width]),
          reach,
        );
  const y =
    kept === "x"
      ? { value: point.y }
      : snapAxis(
          point.y,
          size.height,
          others.map(({ y: at, height }) => [at, height]),
          reach,
        );
  const position = { x: Math.round(x.value), y: Math.round(y.value) };
  const box = { ...position, ...size };
  return {
    position,
    guides: [
      ...(x.line === undefined ? [] : [guideAt("x", x.line, box, others)]),
      ...(y.line === undefined ? [] : [guideAt("y", y.line, box, others)]),
    ],
  };
}

/** With Shift, the axis the drag moved along further; the other stays where it started. */
function keptAxis(raw: FlowPoint, start: StagePosition): "x" | "y" {
  return Math.abs(raw.x - start.x) >= Math.abs(raw.y - start.y) ? "x" : "y";
}

const whole = ({ x, y }: FlowPoint): StagePosition => ({ x: Math.round(x), y: Math.round(y) });

interface SnappedAxis {
  readonly value: number;
  /** The other card's line it snapped to, if any. */
  readonly line?: number;
}

/** One axis: the nearest of the others' lines to one of the card's own, else the grid. */
function snapAxis(
  start: number,
  length: number,
  others: readonly (readonly [number, number])[],
  reach: number,
): SnappedAxis {
  let best: { readonly shift: number; readonly line: number } | undefined;
  for (const [at, size] of others) {
    for (const line of linesOf(at, size)) {
      for (const own of linesOf(start, length)) {
        const shift = line - own;
        if (Math.abs(shift) <= reach && (!best || Math.abs(shift) < Math.abs(best.shift)))
          best = { shift, line };
      }
    }
  }
  return best
    ? { value: start + best.shift, line: best.line }
    : { value: Math.round(start / GRID_STEP) * GRID_STEP };
}

const linesOf = (at: number, size: number): readonly number[] => [at, at + size / 2, at + size];

/** A guide through `line`, from the dragged card to every card that has the same line. */
function guideAt(
  axis: "x" | "y",
  line: number,
  box: FlowBox,
  others: readonly FlowBox[],
): FlowGuide {
  const across = (each: FlowBox): readonly [number, number] =>
    axis === "x" ? [each.y, each.y + each.height] : [each.x, each.x + each.width];
  const own = (each: FlowBox): readonly [number, number] =>
    axis === "x" ? [each.x, each.width] : [each.y, each.height];
  const matched = others.filter((other) =>
    linesOf(...own(other)).some((each) => Math.abs(each - line) < 1),
  );
  const spans = [box, ...matched].map(across);
  return {
    axis,
    at: line,
    from: Math.min(...spans.map(([from]) => from)) - 10,
    to: Math.max(...spans.map(([, to]) => to)) + 10,
  };
}

/** Where a dropped card lands, and the card it would have covered when it was moved off it. */
export interface ClearSpot {
  readonly position: StagePosition;
  readonly covered: FlowCard | undefined;
}

/**
 * Where a card dropped at `box` lands: there, unless it comes within 16 of another card; then on
 * the nearest grid spot that doesn't.
 */
export function clearSpot(box: FlowBox, others: readonly FlowCard[]): ClearSpot {
  const covered = coveredBy(box, others);
  if (!covered) return { position: { x: box.x, y: box.y }, covered: undefined };
  const x = Math.round(box.x / GRID_STEP) * GRID_STEP;
  const y = Math.round(box.y / GRID_STEP) * GRID_STEP;
  for (const [dx, dy] of nearbySteps()) {
    const spot = { ...box, x: x + dx, y: y + dy };
    if (!coveredBy(spot, others)) return { position: { x: spot.x, y: spot.y }, covered };
  }
  return { position: { x: box.x, y: box.y }, covered: undefined };
}

/**
 * Where Shift + an arrow moves a card: one grid step that way, more while that would cover a card,
 * so it steps past it.
 */
export function steppedPast(
  box: FlowBox,
  others: readonly FlowCard[],
  step: { readonly dx: -1 | 0 | 1; readonly dy: -1 | 0 | 1 },
): StagePosition {
  let spot = box;
  for (let tries = 0; tries < MAX_STEPS; tries += 1) {
    spot = { ...spot, x: spot.x + step.dx * GRID_STEP, y: spot.y + step.dy * GRID_STEP };
    if (!coveredBy(spot, others)) break;
  }
  return { x: spot.x, y: spot.y };
}

/** How far, in grid steps either way, a card is looked for a free spot. */
const MAX_STEPS = 40;

function coveredBy(box: FlowBox, others: readonly FlowCard[]): FlowCard | undefined {
  return others.find(({ box: other }) => near(box, other, CLEARANCE));
}

function near(one: FlowBox, other: FlowBox, by: number): boolean {
  return (
    one.x < other.x + other.width + by &&
    other.x < one.x + one.width + by &&
    one.y < other.y + other.height + by &&
    other.y < one.y + one.height + by
  );
}

let steps: readonly (readonly [number, number])[] | undefined;

/** Every grid offset within reach, the nearest first. */
function nearbySteps(): readonly (readonly [number, number])[] {
  steps ??= Array.from({ length: (2 * MAX_STEPS + 1) ** 2 }, (_, index): [number, number] => [
    (Math.floor(index / (2 * MAX_STEPS + 1)) - MAX_STEPS) * GRID_STEP,
    ((index % (2 * MAX_STEPS + 1)) - MAX_STEPS) * GRID_STEP,
  ]).toSorted(([ax, ay], [bx, by]) => ax * ax + ay * ay - (bx * bx + by * by));
  return steps;
}

/**
 * A card's height as the service estimates it where it has to place a Stage itself: 72, or 82
 * plus 22 per route row when it lists its routes (more than one, or one with a condition or a
 * limit).
 */
export function estimatedCardHeight({ routes = [] }: Pick<Stage, "routes">): number {
  const lists =
    routes.length > 1 ||
    routes.some(({ condition, limit }) => condition !== null || (limit ?? null) !== null);
  return lists ? LISTING_CARD_HEIGHT + ROUTE_ROW_HEIGHT * routes.length : CARD_HEIGHT;
}

/** A Stage's box at its position by its estimated height. */
export function estimatedBox(position: StagePosition, stage: Pick<Stage, "routes">): FlowBox {
  return { ...position, width: CARD_WIDTH, height: estimatedCardHeight(stage) };
}

/**
 * Where a Stage with no position stands (spec §2.3, "A Stage's position"): 76 right of the Stage
 * before it in the order, at its y, moving down by the grid's step until it covers no card; at the
 * origin when it is first.
 */
export function freeSpotBeside(
  before: FlowBox | undefined,
  size: FlowSize,
  others: readonly FlowBox[],
): StagePosition {
  const x = before ? before.x + before.width + STAGE_GAP : 0;
  let y = before?.y ?? 0;
  while (others.some((other) => near(other, { width: size.width, height: size.height, x, y }, 0)))
    y += GRID_STEP;
  return { x, y };
}

/** A Stage as End's place reads it: its box and where its route rows are, from its top. */
export interface EndNeighbour {
  readonly box: FlowBox;
  readonly routes: readonly Route[] | undefined;
  readonly rowCentres: readonly number[];
}

/**
 * Where End stands when it has no position: 76 right of the right-most Stage, level with the route
 * to End of the first final Stage in the order (a Stage with a route to End).
 */
export function derivedEndPosition(stages: readonly EndNeighbour[]): StagePosition {
  if (stages.length === 0) return { x: 0, y: 0 };
  const right = Math.max(...stages.map(({ box }) => box.x + box.width));
  const final = stages.find(({ routes }) => routes?.some(({ to }) => to === null));
  const index = final?.routes?.findIndex(({ to }) => to === null) ?? -1;
  const level = final
    ? final.box.y + (final.rowCentres[index] ?? final.box.height / 2)
    : (stages[0]?.box.y ?? 0) + END_SIZE / 2;
  return { x: Math.round(right + STAGE_GAP), y: Math.round(level - END_SIZE / 2) };
}
