import type { Route, RouteLimit, Stage, StagePosition } from "@the-office/contracts";
import { limitOf } from "./flow-model.ts";
import type { FlowOverlay } from "./flow-marks.ts";
import { CARD_WIDTH } from "./flow-snap.ts";

/**
 * The flow canvas's geometry (docs/design/pipeline-flow.html, docs/design/pipeline-free-placement.html),
 * apart from React: the lines to draw, the room they take around the cards, the start marker, and
 * the narrow view's bands. The routes' paths are the chosen route drawer's (flow-routes/). Across,
 * each Stage stands at its position; down (a canvas under 560px wide) the Stages stand in bands
 * from their positions, top to bottom (`narrowLayout`).
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

export interface FlowStartPath extends FlowPath {
  readonly dot: FlowPoint;
}

/** Where a Stage or End goes in the narrow view's grid. */
export interface FlowGridCell {
  readonly gridColumn: string;
  readonly gridRow: string;
}

/**
 * The narrow view's bands, top to bottom, each its Stages' keys in the order they stand side by
 * side (docs/design/pipeline-free-placement.html, "Narrow screens"): going through the Stages by
 * x, a Stage joins the band before when its card overlaps it by at least half a card, otherwise it
 * starts a new one; within a band, top first. Stored positions never change.
 */
export function narrowBands(
  stages: readonly { readonly key: string; readonly position?: StagePosition }[],
): readonly (readonly string[])[] {
  const at = (index: number): StagePosition => stages[index]?.position ?? { x: 0, y: 0 };
  const byX = stages
    .map((_, index) => index)
    .toSorted((a, b) => at(a).x - at(b).x || at(a).y - at(b).y || a - b);
  const bands: { right: number; members: number[] }[] = [];
  for (const index of byX) {
    const { x } = at(index);
    const band = bands.at(-1);
    if (band && x <= band.right - CARD_WIDTH / 2) {
      band.members.push(index);
      band.right = Math.max(band.right, x + CARD_WIDTH);
    } else {
      bands.push({ right: x + CARD_WIDTH, members: [index] });
    }
  }
  return bands.map(({ members }) =>
    members.toSorted((a, b) => at(a).y - at(b).y || a - b).map((index) => stages[index]!.key),
  );
}

/** At most this many Stages of a band side by side; the next wraps onto a new line. */
const BAND_LINE = 2;

export interface FlowNarrowLayout {
  readonly cells: ReadonlyMap<string, FlowGridCell>;
  /** Each Stage's band, from 0 at the top. */
  readonly bands: ReadonlyMap<string, number>;
  readonly columns: number;
  /** End, last, in a band of its own across the whole width. */
  readonly end: FlowGridCell;
}

/** The narrow view's grid: each band's Stages side by side, at most two to a line, End last. */
export function narrowLayout(bands: readonly (readonly string[])[]): FlowNarrowLayout {
  const cells = new Map<string, FlowGridCell>();
  const bandOf = new Map<string, number>();
  let row = 0;
  for (const [band, keys] of bands.entries()) {
    for (const [slot, key] of keys.entries()) {
      cells.set(key, {
        gridColumn: String((slot % BAND_LINE) + 1),
        gridRow: String(row + Math.floor(slot / BAND_LINE) + 1),
      });
      bandOf.set(key, band);
    }
    row += Math.ceil(keys.length / BAND_LINE);
  }
  return {
    cells,
    bands: bandOf,
    columns: Math.min(BAND_LINE, Math.max(1, ...bands.map((keys) => keys.length))),
    end: { gridColumn: "1 / -1", gridRow: String(row + 1) },
  };
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
 * The lines to draw: each Stage's routes, on and back alike in the Pipeline's order, then a
 * Proposal's proposed and taken-away routes, which no press picks.
 */
export function flowLines(stages: readonly Stage[], overlay?: FlowOverlay): readonly FlowLine[] {
  const own = stages.flatMap((stage) => {
    const lists = listsRoutes(stage, stages);
    return (stage.routes ?? []).map((route, index): FlowLine => ({
      id: `${stage.key}:${index}`,
      fromKey: stage.key,
      to: route.to,
      routeIndex: index,
      port: lists ? index : undefined,
      look: "plain",
      limit: limitOf(stages, stage.key, route),
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
      limit: route.limit ?? null,
    })),
  );
}

/** The room the canvas keeps on each side of the box around its cards for the lines, in px. */
export interface FlowRoom {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export const NO_ROOM: FlowRoom = { top: 0, right: 0, bottom: 0, left: 0 };

const roomOf = (reach: number): number => Math.max(0, Math.ceil(reach));

/**
 * How far the drawn lines, arrows and marks (`bounds`) reach past the box around every card on each
 * side: exactly the room they take, none where they stay inside it.
 */
export function flowRoom(bounds: FlowBox | undefined, measure: FlowMeasure): FlowRoom {
  const cards = outerEdges(measure);
  if (!bounds || !cards) return NO_ROOM;
  return {
    top: roomOf(cards.top - bounds.y),
    right: roomOf(bounds.x + bounds.width - cards.right),
    bottom: roomOf(bounds.y + bounds.height - cards.bottom),
    left: roomOf(cards.left - bounds.x),
  };
}

type Pt = readonly [number, number];

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

/** The point a route being drawn from a Stage's + starts at. */
export function drawingStart(box: FlowBox, orientation: FlowOrientation): FlowPoint {
  return orientation === "across"
    ? { x: box.x + box.width, y: middleY(box) }
    : { x: middleX(box), y: box.y + box.height };
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

function outerEdges(
  measure: FlowMeasure,
): { top: number; left: number; bottom: number; right: number } | undefined {
  const boxes = [
    ...[...measure.stages.values()].map(({ box }) => box),
    ...(measure.end ? [measure.end] : []),
  ];
  if (boxes.length === 0) return undefined;
  return {
    top: Math.min(...boxes.map(({ y }) => y)),
    left: Math.min(...boxes.map(({ x }) => x)),
    bottom: Math.max(...boxes.map(({ y, height }) => y + height)),
    right: Math.max(...boxes.map(({ x, width }) => x + width)),
  };
}
