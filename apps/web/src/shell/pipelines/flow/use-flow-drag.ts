import { type PointerEvent, type RefObject, useRef, useState } from "react";
import {
  dropAt,
  type FlowBox,
  type FlowDropAt,
  type FlowPoint,
  type FlowTracks,
} from "./flow-layout.ts";
import type { FlowDrop } from "./flow-model.ts";
import type { FlowCanvasEdit } from "./flow-view.ts";

/** A Stage being dragged to a place: how far it moved, and where it would drop. */
export interface StageDrag {
  readonly kind: "stage";
  readonly key: string;
  readonly pointerId: number;
  readonly x0: number;
  readonly y0: number;
  readonly moved: boolean;
  readonly dx: number;
  readonly dy: number;
  /** The drop place, its ghost relative to the canvas. */
  readonly at: FlowDropAt | undefined;
}

/** A route being drawn from a Stage's +: the pointer, and the Stage or End (null) under it. */
export interface RouteDrag {
  readonly kind: "route";
  readonly from: string;
  readonly pointerId: number;
  readonly point: FlowPoint;
  readonly target: string | null | undefined;
}

export type FlowDrag = StageDrag | RouteDrag;

/** How far a press moves before it is a drag rather than a pick, in px. */
const DRAG_START = 5;

export interface FlowDragging {
  readonly drag: FlowDrag | undefined;
  readonly onStagePointer: (event: PointerEvent<HTMLDivElement>, key: string) => void;
  readonly onHandlePointer: (event: PointerEvent<HTMLButtonElement>, key: string) => void;
  readonly onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: () => void;
  /** Whether a click is the end of a drag, which picks nothing. */
  readonly endsDrag: () => boolean;
}

export interface FlowDragOptions {
  readonly canvas: RefObject<HTMLElement | null>;
  readonly canDrag: (key: string) => boolean;
  /** Whether a dragged Stage may drop there: not among a Task's frozen columns. */
  readonly canDrop: (drop: FlowDrop) => boolean;
  /** Whether a route may be drawn from the Stage: not from a Task's started one. */
  readonly canDraw: (key: string) => boolean;
  readonly onEdit: ((edit: FlowCanvasEdit) => void) | undefined;
}

/**
 * Dragging on the canvas, by Pointer Events with the pointer captured: a Stage to a place, or a
 * route from a Stage's + to a Stage or End. A touch that turns into a scroll ends in pointercancel,
 * which drops nothing.
 */
export function useFlowDrag(options: FlowDragOptions): FlowDragging {
  const [drag, setDrag] = useState<FlowDrag | undefined>(undefined);
  const dragged = useRef(false);
  const move = (event: PointerEvent<HTMLElement>): void => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    setDrag(
      drag.kind === "stage" ? movedStage(drag, event, options) : movedRoute(drag, event, options),
    );
  };
  const up = (event: PointerEvent<HTMLElement>): void => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    setDrag(undefined);
    if (drag.kind === "route") {
      if (drag.target === undefined) return;
      // The click that follows on the + would pick its Stage over the route just drawn.
      dragged.current = true;
      options.onEdit?.({ kind: "draw-route", from: drag.from, to: drag.target });
      return;
    }
    if (!drag.moved) return;
    dragged.current = true;
    if (drag.at) options.onEdit?.({ kind: "drop", key: drag.key, drop: drag.at.drop });
  };
  return {
    drag,
    onStagePointer: (event, key) => {
      if (event.button > 0 || !options.canDrag(key)) return;
      if ((event.target as Element).closest("[data-flow-route], .flow-canvas-handle")) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      dragged.current = false;
      setDrag({
        kind: "stage",
        key,
        pointerId: event.pointerId,
        x0: event.clientX,
        y0: event.clientY,
        moved: false,
        dx: 0,
        dy: 0,
        at: undefined,
      });
    },
    onHandlePointer: (event, key) => {
      if (event.button > 0 || !options.canDraw(key)) return;
      event.stopPropagation();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      dragged.current = false;
      setDrag({
        kind: "route",
        from: key,
        pointerId: event.pointerId,
        point: canvasPoint(options.canvas.current, event),
        target: undefined,
      });
    },
    onPointerMove: move,
    onPointerUp: up,
    onPointerCancel: () => setDrag(undefined),
    endsDrag: () => {
      const was = dragged.current;
      dragged.current = false;
      return was;
    },
  };
}

function movedStage(
  drag: StageDrag,
  event: PointerEvent<HTMLElement>,
  { canvas, canDrop }: FlowDragOptions,
): StageDrag {
  const dx = event.clientX - drag.x0;
  const dy = event.clientY - drag.y0;
  if (!drag.moved && Math.hypot(dx, dy) < DRAG_START) return drag;
  const grid = canvas.current?.querySelector<HTMLElement>(".flow-canvas-grid");
  const at = grid ? dropOn(canvas.current, grid, event) : undefined;
  return { ...drag, moved: true, dx, dy, at: at && canDrop(at.drop) ? at : undefined };
}

function dropOn(
  canvas: HTMLElement | null,
  grid: HTMLElement,
  event: PointerEvent<HTMLElement>,
): FlowDropAt {
  const rect = grid.getBoundingClientRect();
  const at = dropAt(
    tracksOf(grid),
    { x: event.clientX - rect.left, y: event.clientY - rect.top },
    "across",
  );
  const offset = canvasPoint(canvas, { clientX: rect.left, clientY: rect.top });
  const ghost: FlowBox = { ...at.ghost, x: at.ghost.x + offset.x, y: at.ghost.y + offset.y };
  return { ...at, ghost };
}

/** A computed track list's sizes, "120px 80px" as [120, 80]. */
function sizes(list: string): number[] {
  return list
    .split(" ")
    .map(Number.parseFloat)
    .filter((size) => Number.isFinite(size));
}

/** The grid's tracks as the browser laid them out, which its computed style gives in px. */
function tracksOf(grid: HTMLElement): FlowTracks {
  const style = getComputedStyle(grid);
  return {
    columns: sizes(style.gridTemplateColumns),
    rows: sizes(style.gridTemplateRows),
    columnGap: Number.parseFloat(style.columnGap) || 0,
    rowGap: Number.parseFloat(style.rowGap) || 0,
  };
}

function movedRoute(
  drag: RouteDrag,
  event: PointerEvent<HTMLElement>,
  { canvas }: FlowDragOptions,
): RouteDrag {
  return {
    ...drag,
    point: canvasPoint(canvas.current, event),
    target: targetUnder(canvas.current, event, drag.from),
  };
}

/** The Stage (its key) or End (null) under the pointer that a route may be drawn to. */
function targetUnder(
  canvas: HTMLElement | null,
  { clientX, clientY }: { clientX: number; clientY: number },
  from: string,
): string | null | undefined {
  const hit = document.elementFromPoint?.(clientX, clientY);
  const place = hit?.closest<HTMLElement>(
    "[data-flow-stage]:not([data-flow-removed]), [data-flow-end]",
  );
  if (!place || !canvas?.contains(place)) return undefined;
  if (place.dataset.flowEnd !== undefined) return null;
  const key = place.dataset.flowStage;
  return key === undefined || key === from ? undefined : key;
}

function canvasPoint(
  canvas: HTMLElement | null,
  { clientX, clientY }: { clientX: number; clientY: number },
): FlowPoint {
  const rect = canvas?.getBoundingClientRect();
  return {
    x: clientX - (rect?.left ?? 0) - (canvas?.clientLeft ?? 0),
    y: clientY - (rect?.top ?? 0) - (canvas?.clientTop ?? 0),
  };
}
