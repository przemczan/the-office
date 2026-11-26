import type { StagePosition } from "@the-office/contracts";
import { type PointerEvent, type RefObject, useRef, useState } from "react";
import type { FlowPoint } from "./flow-layout.ts";
import { type ClearSpot, clearSpot, type FlowCard, type FlowGuide, snapMove } from "./flow-snap.ts";
import type { FlowCanvasEdit } from "./flow-view.ts";
import { scaleOf } from "./use-flow-measure.ts";

/**
 * A Stage (its key) or End (null) being dragged on the canvas: where it was, where it shows now,
 * snapped, with the guides it snapped to, and where it would land, clear of every other card.
 */
export interface CardDrag {
  readonly kind: "card";
  readonly key: string | null;
  readonly pointerId: number;
  /** Where the press was, in the canvas's own pixels, so the view may move under the drag. */
  readonly x0: number;
  readonly y0: number;
  /** The card's position when the drag started. */
  readonly start: StagePosition;
  /** The canvas's origin when the drag started, which holds while it lasts. */
  readonly origin: StagePosition;
  readonly moved: boolean;
  readonly shown: StagePosition;
  readonly guides: readonly FlowGuide[];
  readonly landing: ClearSpot | undefined;
}

/** A route being drawn from a Stage's +: the pointer, and the Stage or End (null) under it. */
export interface RouteDrag {
  readonly kind: "route";
  readonly from: string;
  readonly pointerId: number;
  readonly point: FlowPoint;
  readonly target: string | null | undefined;
}

export type FlowDrag = CardDrag | RouteDrag;

/** How far a press moves before it is a drag rather than a pick, in px. */
const DRAG_START = 5;

export interface FlowDragging {
  readonly drag: FlowDrag | undefined;
  readonly onCardPointer: (event: PointerEvent<HTMLElement>, key: string | null) => void;
  readonly onHandlePointer: (event: PointerEvent<HTMLButtonElement>, key: string) => void;
  readonly onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: () => void;
  /** Whether a click is the end of a drag, which picks nothing. */
  readonly endsDrag: () => boolean;
}

export interface FlowDragOptions {
  readonly canvas: RefObject<HTMLElement | null>;
  /** Whether a Stage or End can be dragged: not on a read-only or narrow canvas. */
  readonly canDrag: (key: string | null) => boolean;
  /** Whether a route may be drawn from the Stage: not from a Task's started one. */
  readonly canDraw: (key: string) => boolean;
  /** Every card as it stands, in canvas units: what a dragged one snaps to and lands clear of. */
  readonly cards: readonly FlowCard[];
  /** Where the canvas's box starts, in canvas units. */
  readonly origin: StagePosition;
  /** The viewport's zoom, by which snapping's reach is scaled. */
  readonly zoom: number;
  readonly onEdit: ((edit: FlowCanvasEdit) => void) | undefined;
  /** Each move of a drag, so the viewport can follow it near its edge. */
  readonly onDragMove?: ((point: { clientX: number; clientY: number }) => void) | undefined;
}

/**
 * Dragging on the canvas, by Pointer Events with the pointer captured: a Stage or End anywhere,
 * snapping as `snapMove` says (Alt held, freely; Shift held, along its row or column) and dropped
 * where `clearSpot` lands it; or a route from a Stage's + to a Stage or End. A touch that turns into
 * a scroll ends in pointercancel, which drops nothing.
 */
export function useFlowDrag(options: FlowDragOptions): FlowDragging {
  const [drag, setDrag] = useState<FlowDrag | undefined>(undefined);
  const dragged = useRef(false);
  const move = (event: PointerEvent<HTMLElement>): void => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.kind === "route" || drag.moved) options.onDragMove?.(event);
    setDrag(
      drag.kind === "card" ? movedCard(drag, event, options) : movedRoute(drag, event, options),
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
    if (!drag.moved || !drag.landing) return;
    dragged.current = true;
    const { position, covered } = drag.landing;
    if (!covered && position.x === drag.start.x && position.y === drag.start.y) return;
    options.onEdit?.({
      kind: "move-to",
      key: drag.key,
      position,
      ...(covered ? { beside: covered.key } : {}),
    });
  };
  return {
    drag,
    onCardPointer: (event, key) => {
      if (event.button > 0 || !options.canDrag(key)) return;
      if ((event.target as Element).closest("[data-flow-route], .flow-canvas-handle")) return;
      const card = options.cards.find((each) => each.key === key);
      if (!card) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      dragged.current = false;
      const at = canvasPoint(options.canvas.current, event);
      const start = { x: card.box.x, y: card.box.y };
      setDrag({
        kind: "card",
        key,
        pointerId: event.pointerId,
        x0: at.x,
        y0: at.y,
        start,
        origin: options.origin,
        moved: false,
        shown: start,
        guides: [],
        landing: undefined,
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

function movedCard(
  drag: CardDrag,
  event: PointerEvent<HTMLElement>,
  { canvas, cards, zoom }: FlowDragOptions,
): CardDrag {
  const point = canvasPoint(canvas.current, event);
  const dx = point.x - drag.x0;
  const dy = point.y - drag.y0;
  if (!drag.moved && Math.hypot(dx, dy) < DRAG_START) return drag;
  const own = cards.find(({ key }) => key === drag.key);
  if (!own) return drag;
  const others = cards.filter(({ key }) => key !== drag.key);
  const size = { width: own.box.width, height: own.box.height };
  const snapped = snapMove(
    { x: drag.start.x + dx, y: drag.start.y + dy },
    size,
    others.map(({ box }) => box),
    { zoom, free: event.altKey, along: event.shiftKey ? drag.start : undefined },
  );
  return {
    ...drag,
    moved: true,
    shown: snapped.position,
    guides: snapped.guides,
    landing: clearSpot({ ...snapped.position, ...size }, others),
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
  const place = hit?.closest<HTMLElement>("[data-flow-stage], [data-flow-end]");
  if (!place || !canvas?.contains(place)) return undefined;
  if (place.dataset.flowEnd !== undefined) return null;
  const key = place.dataset.flowStage;
  return key === undefined || key === from ? undefined : key;
}

/** A point on the screen in the canvas's own pixels, whatever the viewport's zoom. */
function canvasPoint(
  canvas: HTMLElement | null,
  { clientX, clientY }: { clientX: number; clientY: number },
): FlowPoint {
  if (!canvas) return { x: clientX, y: clientY };
  const rect = canvas.getBoundingClientRect();
  const scale = scaleOf(canvas, rect);
  return {
    x: (clientX - rect.left) / scale - canvas.clientLeft,
    y: (clientY - rect.top) / scale - canvas.clientTop,
  };
}
