import { type FigureHitBox, figureAt } from "./figure-hit.ts";
import type { ArtRect } from "./office-geometry.ts";
import { type Point, type View, panBy, pinchTo } from "./view.ts";

/** What the canvas's own pointer, wheel and key handling reads and moves. */
export interface StageInputTarget {
  /** The view and the office's bounds, or null before the office is laid out. */
  current(): { readonly view: View; readonly bounds: ArtRect } | null;
  setView(view: View): void;
  zoomStep(direction: 1 | -1, anchor?: Point): void;
  fit(): void;
  figures(): readonly FigureHitBox[];
  onHover(roleKey: string | null): void;
  onPress(roleKey: string, pointerType: string): void;
}

/** A press that moves less than this, in CSS pixels, is a press, not a drag. */
const DRAG_THRESHOLD = 4;
const KEY_PAN = 48;
/** Wheel travel, in pixels, that makes one zoom step: one notch of a mouse wheel. */
const WHEEL_STEP = 40;
const WHEEL_RESET_MS = 220;

type Gesture =
  | {
      readonly kind: "drag";
      readonly start: Point;
      readonly view: View;
      moved: boolean;
    }
  | {
      readonly kind: "pinch";
      readonly distance: number;
      readonly middle: Point;
      readonly view: View;
    };

const middleOf = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const distanceOf = (a: Point, b: Point): number => Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));

/**
 * The floor's input, the page's own handling rather than Pixi's events: drag (one finger) to pan,
 * the wheel to zoom a step a notch round the pointer, two fingers to pinch and pan, arrows, + - and
 * 0 while the canvas is focused, hover and press on figures. Returns what removes it all.
 */
export function attachStageInput(canvas: HTMLCanvasElement, target: StageInputTarget): () => void {
  const pointers = new Map<number, Point>();
  let gesture: Gesture | null = null;
  let hovered: string | null = null;
  let wheel = 0;
  let wheelTimer: ReturnType<typeof setTimeout> | undefined;

  const pointOf = (event: MouseEvent): Point => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const hover = (roleKey: string | null): void => {
    if (roleKey === hovered) return;
    hovered = roleKey;
    target.onHover(roleKey);
  };
  const startGesture = (): void => {
    const current = target.current();
    const [a, b] = [...pointers.values()];
    if (!current || !a) {
      gesture = null;
    } else if (b) {
      gesture = {
        kind: "pinch",
        distance: distanceOf(a, b),
        middle: middleOf(a, b),
        view: current.view,
      };
    } else {
      gesture = { kind: "drag", start: a, view: current.view, moved: false };
    }
  };
  /** When one finger of a pinch lifts, the other pans on, and its lift is no press. */
  const resumeAfterPinch = (): void => {
    if (pointers.size === 0) {
      gesture = null;
      return;
    }
    startGesture();
    if (gesture?.kind === "drag") gesture.moved = true;
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic event has no pointer to capture.
    }
    pointers.set(event.pointerId, pointOf(event));
    // A second finger turns the drag into a pinch; a third changes nothing.
    if (pointers.size <= 2) startGesture();
  };

  const onPointerMove = (event: PointerEvent): void => {
    const point = pointOf(event);
    if (!pointers.has(event.pointerId)) {
      if (event.pointerType !== "touch" && event.buttons === 0) {
        const current = target.current();
        hover(current ? figureAt(point, current.view, target.figures()) : null);
      }
      return;
    }
    pointers.set(event.pointerId, point);
    const current = target.current();
    if (!current || !gesture) return;
    if (gesture.kind === "drag") {
      const dx = point.x - gesture.start.x;
      const dy = point.y - gesture.start.y;
      if (!gesture.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      gesture.moved = true;
      target.setView(panBy(gesture.view, dx, dy, current.bounds));
      return;
    }
    const [a, b] = [...pointers.values()];
    if (!a || !b) return;
    const middle = middleOf(a, b);
    const zoomed = pinchTo(
      gesture.view,
      distanceOf(a, b) / gesture.distance,
      gesture.middle.x,
      gesture.middle.y,
      current.bounds,
    );
    target.setView(
      panBy(zoomed, middle.x - gesture.middle.x, middle.y - gesture.middle.y, current.bounds),
    );
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!pointers.has(event.pointerId)) return;
    const point = pointOf(event);
    pointers.delete(event.pointerId);
    const pressed = gesture?.kind === "drag" && !gesture.moved && pointers.size === 0;
    resumeAfterPinch();
    if (!pressed) return;
    const current = target.current();
    const roleKey = current ? figureAt(point, current.view, target.figures()) : null;
    if (roleKey) target.onPress(roleKey, event.pointerType);
  };

  const onPointerCancel = (event: PointerEvent): void => {
    pointers.delete(event.pointerId);
    resumeAfterPinch();
  };

  const onPointerLeave = (): void => {
    if (pointers.size === 0) hover(null);
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => (wheel = 0), WHEEL_RESET_MS);
    wheel += event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1);
    if (Math.abs(wheel) < WHEEL_STEP) return;
    target.zoomStep(wheel < 0 ? 1 : -1, pointOf(event));
    wheel = 0;
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const moves: Readonly<Record<string, readonly [number, number]>> = {
      ArrowLeft: [KEY_PAN, 0],
      ArrowRight: [-KEY_PAN, 0],
      ArrowUp: [0, KEY_PAN],
      ArrowDown: [0, -KEY_PAN],
    };
    const move = moves[event.key];
    if (move) {
      const current = target.current();
      if (current) target.setView(panBy(current.view, move[0], move[1], current.bounds));
    } else if (event.key === "+" || event.key === "=") target.zoomStep(1);
    else if (event.key === "-" || event.key === "_") target.zoomStep(-1);
    else if (event.key === "0") target.fit();
    else return;
    event.preventDefault();
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("keydown", onKeyDown);
  return () => {
    clearTimeout(wheelTimer);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerCancel);
    canvas.removeEventListener("pointerleave", onPointerLeave);
    canvas.removeEventListener("wheel", onWheel);
    canvas.removeEventListener("keydown", onKeyDown);
  };
}
