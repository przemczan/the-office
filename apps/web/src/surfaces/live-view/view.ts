import type { FigureBounds } from "./art/figures.ts";
import type { ArtRect } from "./office-geometry.ts";

/** What a resize keeps in view: the whole office, where the user moved it, or one figure. */
export type Framing = { kind: "office" } | { kind: "user" } | { kind: "figure"; roleKey: string };

/** The floor's pan and zoom. */
export interface View {
  /** The canvas box, in CSS pixels. */
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
  /**
   * Device pixels per art pixel: 0.5 or a whole number, but for the whole office's own level, which
   * may be in-between (`isWholeLevel`).
   */
  readonly level: number;
  /** Where the art's (0, 0) lands, in CSS pixels. */
  readonly offsetX: number;
  readonly offsetY: number;
  /** The level that shows the whole office exactly; zooming out stops there. */
  readonly minLevel: number;
  readonly framing: Framing;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Room left round a fitted office, so the List button (top right) and the zoom buttons (bottom right) don't cover it. */
export const FIT_MARGINS = { top: 56, right: 16, bottom: 64, left: 16 } as const;

/** How much of the office a pan keeps in view, in CSS pixels. */
const KEEP_IN_VIEW = 80;
const MAX_CSS_SCALE = 6;
const FIGURE_FRAME_MAX_SCALE = 3;
/** The first zoom step, half a device pixel per art pixel. */
const FIRST_LEVEL = 0.5;
/** How close to a whole step an exact fit snaps to it, so float noise never draws through a texture. */
const WHOLE_LEVEL_SNAP = 1e-6;

export function createView(width: number, height: number, devicePixelRatio: number): View {
  return {
    width,
    height,
    devicePixelRatio,
    level: 2,
    offsetX: 0,
    offsetY: 0,
    minLevel: FIRST_LEVEL,
    framing: { kind: "office" },
  };
}

/** Device pixels per art pixel: half a pixel for a big office on a small screen, then whole numbers up to six CSS pixels. */
export function zoomLevels(devicePixelRatio: number): number[] {
  const levels = [FIRST_LEVEL];
  for (let level = 1; level <= Math.max(1, Math.floor(MAX_CSS_SCALE * devicePixelRatio)); level++)
    levels.push(level);
  return levels;
}

/** CSS pixels per art pixel. */
export function scaleOf(view: View): number {
  return view.level / view.devicePixelRatio;
}

export function nearestLevel(devicePixelRatio: number, wanted: number): number {
  return zoomLevels(devicePixelRatio).reduce((best, level) =>
    Math.abs(level - wanted) < Math.abs(best - wanted) ? level : best,
  );
}

function topLevel(devicePixelRatio: number): number {
  const levels = zoomLevels(devicePixelRatio);
  return levels[levels.length - 1] ?? 1;
}

/** Whether a level is one of the zoom steps, as against the whole office's in-between one. */
export function isWholeLevel(level: number): boolean {
  return level === FIRST_LEVEL || Number.isInteger(level);
}

/**
 * The whole step the art is drawn at: the level itself, or at an in-between level the next whole
 * step up, which the stage scales down smoothly so every art pixel stays the same size.
 */
export function drawnLevel(level: number): number {
  return isWholeLevel(level) ? level : Math.ceil(level);
}

/** The room inside the margins, in CSS pixels. */
function framedArea(view: View): { width: number; height: number } {
  return {
    width: view.width - FIT_MARGINS.left - FIT_MARGINS.right,
    height: view.height - FIT_MARGINS.top - FIT_MARGINS.bottom,
  };
}

/** `bounds` centred inside the margins at `level`. */
function centredAt(view: View, bounds: ArtRect, level: number): View {
  const { width, height } = framedArea(view);
  const scale = level / view.devicePixelRatio;
  return {
    ...view,
    level,
    offsetX: FIT_MARGINS.left + (width - bounds.width * scale) / 2 - bounds.x * scale,
    offsetY: FIT_MARGINS.top + (height - bounds.height * scale) / 2 - bounds.y * scale,
  };
}

/** The largest zoom step at which `bounds` fits inside the margins, centred; `maxScale` caps it, in CSS pixels per art pixel. */
export function frameBounds(view: View, bounds: ArtRect, maxScale = Infinity): View {
  const { width, height } = framedArea(view);
  const levels = zoomLevels(view.devicePixelRatio);
  let level = levels[0] ?? FIRST_LEVEL;
  for (const candidate of levels) {
    const scale = candidate / view.devicePixelRatio;
    if (bounds.width * scale <= width && bounds.height * scale <= height && scale <= maxScale) {
      level = candidate;
    }
  }
  return centredAt(view, bounds, level);
}

/**
 * The level at which the whole office fills the margins exactly: in-between steps allowed, never
 * under half a pixel nor over the top step.
 */
function exactFitLevel(view: View, officeBounds: ArtRect): number {
  const { width, height } = framedArea(view);
  const fits =
    Math.min(width / officeBounds.width, height / officeBounds.height) * view.devicePixelRatio;
  const level = Math.min(topLevel(view.devicePixelRatio), Math.max(FIRST_LEVEL, fits));
  const whole = Math.round(level);
  return Math.abs(level - whole) < WHOLE_LEVEL_SNAP ? whole : level;
}

/** The whole office at the largest level that fits; that level becomes the furthest one can zoom out. */
export function fitView(view: View, officeBounds: ArtRect): View {
  if (view.width <= 0 || view.height <= 0) return view;
  const fitted = centredAt(view, officeBounds, exactFitLevel(view, officeBounds));
  return { ...fitted, minLevel: fitted.level, framing: { kind: "office" } };
}

/** Moves the view back so at least 80 CSS pixels of the office stay in it on each axis. */
export function clampView(view: View, officeBounds: ArtRect): View {
  const scale = scaleOf(view);
  const left = officeBounds.x * scale + view.offsetX;
  const right = (officeBounds.x + officeBounds.width) * scale + view.offsetX;
  const top = officeBounds.y * scale + view.offsetY;
  const bottom = (officeBounds.y + officeBounds.height) * scale + view.offsetY;
  let { offsetX, offsetY } = view;
  if (right < KEEP_IN_VIEW) offsetX += KEEP_IN_VIEW - right;
  if (left > view.width - KEEP_IN_VIEW) offsetX -= left - (view.width - KEEP_IN_VIEW);
  if (bottom < KEEP_IN_VIEW) offsetY += KEEP_IN_VIEW - bottom;
  if (top > view.height - KEEP_IN_VIEW) offsetY -= top - (view.height - KEEP_IN_VIEW);
  if (offsetX === view.offsetX && offsetY === view.offsetY) return view;
  return { ...view, offsetX, offsetY };
}

export function panBy(view: View, dx: number, dy: number, officeBounds: ArtRect): View {
  return clampView(
    { ...view, offsetX: view.offsetX + dx, offsetY: view.offsetY + dy, framing: { kind: "user" } },
    officeBounds,
  );
}

/** Zooms to `level` keeping the art point under the anchor (the middle of the view by default) where it is. */
export function zoomTo(
  view: View,
  level: number,
  officeBounds: ArtRect,
  anchorX = view.width / 2,
  anchorY = view.height / 2,
): View {
  const before = scaleOf(view);
  const artX = (anchorX - view.offsetX) / before;
  const artY = (anchorY - view.offsetY) / before;
  const after = level / view.devicePixelRatio;
  return clampView(
    {
      ...view,
      level,
      offsetX: anchorX - artX * after,
      offsetY: anchorY - artY * after,
      framing: { kind: "user" },
    },
    officeBounds,
  );
}

/**
 * The levels one may zoom between: from the whole office (or lower, when already there) to the top,
 * the whole steps and the whole office's own level, which may be in-between.
 */
function reachableLevels(view: View): number[] {
  const floor = Math.min(view.minLevel, view.level);
  const steps = zoomLevels(view.devicePixelRatio).filter(
    (level) => level >= floor && level !== view.minLevel,
  );
  return [...steps, view.minLevel].toSorted((a, b) => a - b);
}

/** One step in or out, round the anchor; never past the whole office or the top level. */
export function zoomStep(
  view: View,
  direction: 1 | -1,
  officeBounds: ArtRect,
  anchorX?: number,
  anchorY?: number,
): View {
  const levels = reachableLevels(view);
  const next =
    direction === 1
      ? levels.find((level) => level > view.level)
      : levels.findLast((level) => level < view.level);
  if (next === undefined || next === view.level) return view;
  return zoomTo(view, next, officeBounds, anchorX, anchorY);
}

/** A pinch: the level times `scaleFactor`, snapped to the nearest reachable level, round the fingers. */
export function pinchTo(
  view: View,
  scaleFactor: number,
  anchorX: number,
  anchorY: number,
  officeBounds: ArtRect,
): View {
  const wanted = view.level * scaleFactor;
  const next = reachableLevels(view).reduce((best, level) =>
    Math.abs(level - wanted) < Math.abs(best - wanted) ? level : best,
  );
  if (next === view.level) return view;
  return zoomTo(view, next, officeBounds, anchorX, anchorY);
}

/** What Show on the floor frames round a figure's feet, in art pixels: its surroundings. */
const FIGURE_SURROUNDINGS = { left: 60, up: 50, width: 120, height: 80 } as const;
/** Room kept round a figure's own bounds, should they reach past its surroundings. */
const FIGURE_ROOM = 16;

/**
 * The box round a figure that Show on the floor frames, from its feet in art pixels: its
 * surroundings, grown to hold its bounds (`figureBoundsOf` its pose) with room round them.
 */
export function figureFrame(feet: Point, bounds?: FigureBounds): ArtRect {
  let left = feet.x - FIGURE_SURROUNDINGS.left;
  let top = feet.y - FIGURE_SURROUNDINGS.up;
  let right = left + FIGURE_SURROUNDINGS.width;
  let bottom = top + FIGURE_SURROUNDINGS.height;
  if (bounds) {
    left = Math.min(left, feet.x + bounds.left - FIGURE_ROOM);
    top = Math.min(top, feet.y + bounds.top - FIGURE_ROOM);
    right = Math.max(right, feet.x + bounds.right + FIGURE_ROOM);
    bottom = Math.max(bottom, feet.y + bounds.bottom + FIGURE_ROOM);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Frames a figure (Show on the floor) at no more than three CSS pixels per art pixel. */
export function frameFigure(
  view: View,
  roleKey: string,
  feet: Point,
  officeBounds: ArtRect,
  bounds?: FigureBounds,
): View {
  const framed = frameBounds(view, figureFrame(feet, bounds), FIGURE_FRAME_MAX_SCALE);
  return clampView({ ...framed, framing: { kind: "figure", roleKey } }, officeBounds);
}

/**
 * A new canvas size: fits again when framed on the office, frames the figure again when framed on one
 * (given its frame, `figureFrame` of its feet), else keeps the art point in the middle of the view.
 */
export function resizeView(
  view: View,
  width: number,
  height: number,
  devicePixelRatio: number,
  officeBounds: ArtRect,
  figureBounds?: ArtRect,
): View {
  if (width <= 0 || height <= 0) return view;
  const hadSize = view.width > 0 && view.height > 0;
  const middle = {
    x: (view.width / 2 - view.offsetX) / scaleOf(view),
    y: (view.height / 2 - view.offsetY) / scaleOf(view),
  };
  const resized: View = { ...view, width, height, devicePixelRatio };
  if (!hadSize || view.framing.kind === "office") return fitView(resized, officeBounds);
  const minLevel = exactFitLevel(resized, officeBounds);
  if (view.framing.kind === "figure" && figureBounds) {
    const framed = frameBounds(resized, figureBounds, FIGURE_FRAME_MAX_SCALE);
    return clampView({ ...framed, minLevel }, officeBounds);
  }
  // At the whole office's own level the view stays at the whole office's new one; a whole step stays
  // (on a new screen, the nearest), but never further out than the whole office.
  const levels = zoomLevels(devicePixelRatio);
  const step = levels.includes(view.level)
    ? view.level
    : nearestLevel(devicePixelRatio, view.level);
  const level = view.level === view.minLevel ? minLevel : Math.max(step, minLevel);
  const scale = level / devicePixelRatio;
  return clampView(
    {
      ...resized,
      level,
      minLevel,
      offsetX: width / 2 - middle.x * scale,
      offsetY: height / 2 - middle.y * scale,
    },
    officeBounds,
  );
}

/** The zoom in per cent, as the zoom controls show it. */
export function zoomPercent(view: View): number {
  return Math.round(scaleOf(view) * 100);
}

export function canZoomIn(view: View): boolean {
  return view.level < topLevel(view.devicePixelRatio);
}

export function canZoomOut(view: View): boolean {
  return view.level > view.minLevel;
}

/** Where the art's (0, 0) is drawn, in CSS pixels: rounded to a whole device pixel so the art stays crisp. */
export function artOrigin(view: View): Point {
  return {
    x: Math.round(view.offsetX * view.devicePixelRatio) / view.devicePixelRatio,
    y: Math.round(view.offsetY * view.devicePixelRatio) / view.devicePixelRatio,
  };
}

/** A point of the art, in CSS pixels on the canvas. */
export function toCanvas(view: View, artPoint: Point): Point {
  const origin = artOrigin(view);
  const scale = scaleOf(view);
  return { x: origin.x + artPoint.x * scale, y: origin.y + artPoint.y * scale };
}

/** A point of the canvas, in CSS pixels, in the art's pixels. */
export function toArtPoint(view: View, canvasPoint: Point): Point {
  const origin = artOrigin(view);
  const scale = scaleOf(view);
  return { x: (canvasPoint.x - origin.x) / scale, y: (canvasPoint.y - origin.y) / scale };
}
