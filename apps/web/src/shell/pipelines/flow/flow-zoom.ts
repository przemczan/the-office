/**
 * The flow canvas's view (docs/design/pipeline-editor.html, "The canvas"): how far it is zoomed and
 * where the content sits in the viewport, in the viewport's pixels. 100% is a Stage card's own size.
 */
export interface FlowZoomView {
  readonly zoom: number;
  readonly x: number;
  readonly y: number;
}

export interface FlowSize {
  readonly width: number;
  readonly height: number;
}

export interface FlowViewPoint {
  readonly x: number;
  readonly y: number;
}

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 1;
/** The steps − and + take; Fit picks any value between the ends. */
export const ZOOM_STEPS: readonly number[] = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1];
/** Under this, a Stage card shows only its kind mark and its name. */
export const NAMES_ONLY_BELOW = 0.6;
/** How far past its edge the content may be moved when it doesn't fit, in px. */
const OVERSCROLL = 56;
/** The room Fit leaves around the whole Pipeline, in px. */
const FIT_MARGIN = 28;
/** Where a picked Stage is kept from the viewport's edge, in px. */
const IN_VIEW_PAD = 40;
const MIN_HEIGHT = 300;
const MAX_HEIGHT_SHARE = 0.62;

export const AT_START: FlowZoomView = { zoom: ZOOM_MAX, x: 0, y: 0 };

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

export function namesOnlyAt(zoom: number): boolean {
  return zoom < NAMES_ONLY_BELOW;
}

/** The next step in `direction` (1 in, -1 out), or undefined at the end. */
export function steppedZoom(zoom: number, direction: 1 | -1): number | undefined {
  const near = 0.001;
  return direction > 0
    ? ZOOM_STEPS.find((step) => step > zoom + near)
    : ZOOM_STEPS.findLast((step) => step < zoom - near);
}

/**
 * Keeps the content where it can be seen: one that fits stays inside the viewport, one that doesn't
 * may be moved until its edge is OVERSCROLL inside.
 */
export function clampedView(
  view: FlowZoomView,
  viewport: FlowSize,
  content: FlowSize,
): FlowZoomView {
  return {
    zoom: view.zoom,
    x: offsetWithin(view.x, viewport.width, content.width * view.zoom),
    y: offsetWithin(view.y, viewport.height, content.height * view.zoom),
  };
}

function offsetWithin(offset: number, room: number, length: number): number {
  return length <= room
    ? Math.min(room - length, Math.max(0, offset))
    : Math.min(OVERSCROLL, Math.max(room - length - OVERSCROLL, offset));
}

/** Zoomed to `zoom` around `point` of the viewport, which stays over the same part of the content. */
export function zoomedAround(
  view: FlowZoomView,
  zoom: number,
  point: FlowViewPoint,
  viewport: FlowSize,
  content: FlowSize,
): FlowZoomView {
  const next = clampZoom(zoom);
  const contentX = (point.x - view.x) / view.zoom;
  const contentY = (point.y - view.y) / view.zoom;
  return clampedView(
    { zoom: next, x: point.x - contentX * next, y: point.y - contentY * next },
    viewport,
    content,
  );
}

export function pannedBy(
  view: FlowZoomView,
  dx: number,
  dy: number,
  viewport: FlowSize,
  content: FlowSize,
): FlowZoomView {
  return clampedView({ ...view, x: view.x + dx, y: view.y + dy }, viewport, content);
}

/** The whole content in view, centred, never enlarged past 100%. */
export function fittedView(viewport: FlowSize, content: FlowSize): FlowZoomView {
  if (content.width <= 0 || content.height <= 0) return AT_START;
  const zoom = clampZoom(
    Math.min(
      ZOOM_MAX,
      (viewport.width - 2 * FIT_MARGIN) / content.width,
      (viewport.height - 2 * FIT_MARGIN) / content.height,
    ),
  );
  return clampedView(
    {
      zoom,
      x: (viewport.width - content.width * zoom) / 2,
      y: (viewport.height - content.height * zoom) / 2,
    },
    viewport,
    content,
  );
}

/** Centred on `point` of the content, as a press in the Overview asks. */
export function centredOn(
  view: FlowZoomView,
  point: FlowViewPoint,
  viewport: FlowSize,
  content: FlowSize,
): FlowZoomView {
  return clampedView(
    {
      zoom: view.zoom,
      x: viewport.width / 2 - point.x * view.zoom,
      y: viewport.height / 2 - point.y * view.zoom,
    },
    viewport,
    content,
  );
}

/** Moved just enough to bring `box`, in the content's pixels, into view; the same view if it is. */
export function withBoxInView(
  view: FlowZoomView,
  box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  viewport: FlowSize,
  content: FlowSize,
): FlowZoomView {
  const left = view.x + box.x * view.zoom;
  const top = view.y + box.y * view.zoom;
  const right = left + box.width * view.zoom;
  const bottom = top + box.height * view.zoom;
  const dx = shiftIntoView(left, right, viewport.width);
  const dy = shiftIntoView(top, bottom, viewport.height);
  return dx === 0 && dy === 0 ? view : pannedBy(view, dx, dy, viewport, content);
}

function shiftIntoView(start: number, end: number, room: number): number {
  if (start < IN_VIEW_PAD) return IN_VIEW_PAD - start;
  if (end > room - IN_VIEW_PAD) return room - IN_VIEW_PAD - end;
  return 0;
}

/** Whether the content at this zoom runs past the viewport, which is when the Overview shows. */
export function overflows(view: FlowZoomView, viewport: FlowSize, content: FlowSize): boolean {
  return (
    content.width * view.zoom > viewport.width + 1 ||
    content.height * view.zoom > viewport.height + 1
  );
}

/** As tall as the Pipeline at 100%, up to 62% of the window's height, at least 300px. */
export function viewportHeight(contentHeight: number, windowHeight: number): number {
  return Math.round(Math.max(MIN_HEIGHT, Math.min(contentHeight, windowHeight * MAX_HEIGHT_SHARE)));
}
