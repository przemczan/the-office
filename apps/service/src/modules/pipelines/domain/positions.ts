import type { GivenRoute, StagePlace, StagePosition } from "./route.js";

/**
 * Where Stages stand on the flow editor's canvas (docs/design/pipeline-free-placement.html): layout
 * alone, which no rule of the walk, the check or the limits reads. The service knows no card's real
 * height, so it estimates one where it has to place a Stage itself: converting a place, or filling
 * in a position an Agent or a plain list left out.
 */

/** A Stage's card is this wide on the canvas. */
export const CARD_WIDTH = 232;
/** Between two Stages side by side: room for a route's line and its limit mark. */
export const STAGE_GAP = 76;
/** From one column of the old grid to the next. */
export const COLUMN_PITCH = CARD_WIDTH + STAGE_GAP;
/** Between two rows of the old grid. */
export const ROW_GAP = 22;
/** The editor's snapping grid, and the step a filled-in position moves down by until it is clear. */
export const GRID_STEP = 16;

const CARD_HEIGHT = 72;
const LISTING_CARD_HEIGHT = 82;
const ROUTE_ROW_HEIGHT = 22;

interface PlacedStage {
  readonly routes?: readonly GivenRoute[];
}

/**
 * A card's height as the editor draws it at 100%: 72, or 82 plus 22 per route row when it lists its
 * routes (more than one, or one with a condition or a limit).
 */
export function estimatedCardHeight({ routes = [] }: PlacedStage): number {
  const lists =
    routes.length > 1 ||
    routes.some(({ condition, limit }) => condition !== null || (limit ?? null) !== null);
  return lists ? LISTING_CARD_HEIGHT + ROUTE_ROW_HEIGHT * routes.length : CARD_HEIGHT;
}

/**
 * Each Stage's position on the old grid (spec §2.3.5, "The move to positions"): its column's x,
 * and below the rows above it, each as tall as its tallest card, 22 apart. Migration 0225 writes
 * the same in SQL.
 */
export function positionsFromPlaces(
  stages: readonly (PlacedStage & { readonly place: StagePlace })[],
): StagePosition[] {
  const rowHeights = new Map<number, number>();
  for (const stage of stages) {
    const { row } = stage.place;
    rowHeights.set(row, Math.max(rowHeights.get(row) ?? 0, estimatedCardHeight(stage)));
  }
  return stages.map(({ place }) => {
    let y = 0;
    for (let row = 0; row < place.row; row += 1) y += (rowHeights.get(row) ?? 0) + ROW_GAP;
    return { x: place.column * COLUMN_PITCH, y };
  });
}

/**
 * Positions for Stages that have none, in the Pipeline's order (spec §2.3, "A Stage's position"):
 * each stands right of the Stage before it, at its y, moving down by the grid's step until it
 * covers no card. The first stands at the origin when it has none.
 */
export function withFilledPositions<Of extends PlacedStage & { readonly position?: StagePosition }>(
  stages: readonly Of[],
): (Of & { readonly position: StagePosition })[] {
  const placed: (Of & { readonly position: StagePosition })[] = [];
  const boxes: Box[] = stages.flatMap((stage) =>
    stage.position ? [boxOf(stage.position, stage)] : [],
  );
  for (const stage of stages) {
    if (stage.position) {
      placed.push({ ...stage, position: stage.position });
      continue;
    }
    const position = freeSpotBeside(placed.at(-1), stage, boxes);
    boxes.push(boxOf(position, stage));
    placed.push({ ...stage, position });
  }
  return placed;
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function boxOf(position: StagePosition, stage: PlacedStage): Box {
  return { ...position, width: CARD_WIDTH, height: estimatedCardHeight(stage) };
}

function freeSpotBeside(
  before: (PlacedStage & { readonly position: StagePosition }) | undefined,
  stage: PlacedStage,
  boxes: readonly Box[],
): StagePosition {
  const x = before ? before.position.x + CARD_WIDTH + STAGE_GAP : 0;
  let y = before?.position.y ?? 0;
  while (boxes.some((box) => overlaps(box, boxOf({ x, y }, stage)))) y += GRID_STEP;
  return { x, y };
}

function overlaps(one: Box, other: Box): boolean {
  return (
    one.x < other.x + other.width &&
    other.x < one.x + one.width &&
    one.y < other.y + other.height &&
    other.y < one.y + one.height
  );
}
