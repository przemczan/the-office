// The dragged edge of a side panel on the window's right: not a window (docs/spec/4.1-ui-rules.md),
// so the page stays usable beside it. The panel keeps its own place and look; this is what makes it
// resizable.
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

const KEY_STEP_PX = 16;

/** How wide a side panel may be, when nothing nearer limits it, and how wide it starts. */
export interface SidePanelWidths {
  readonly least: number;
  readonly standard: number;
  readonly most: number;
}

export interface SidePanelEdgeProps {
  /** What is resized, for a screen reader. */
  readonly label: string;
  readonly width: number;
  readonly least: number;
  readonly most: number;
  /** What a double press goes back to. */
  readonly standard: number;
  /** As the edge moves. */
  readonly onResize: (width: number) => void;
  /** Once the edge rests: what to remember. */
  readonly onResized: (width: number) => void;
}

/**
 * Drag it, or use ← and → with it focused, to resize the panel to its left; a double press goes back
 * to the panel's standard width. It sits on the panel's left border, inside the panel.
 */
export function SidePanelEdge({
  label,
  width,
  least,
  most,
  standard,
  onResize,
  onResized,
}: SidePanelEdgeProps): ReactNode {
  const drag = useRef<{ readonly startX: number; readonly startWidth: number }>(undefined);
  const [dragging, setDragging] = useState(false);
  const fitted = (next: number): number => Math.round(Math.min(Math.max(next, least), most));
  const settle = (next: number): void => {
    onResize(next);
    onResized(next);
  };
  const widthAt = (
    { clientX }: PointerEvent,
    { startX, startWidth }: NonNullable<typeof drag.current>,
  ): number => fitted(startWidth + startX - clientX);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: width };
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (drag.current) onResize(widthAt(event, drag.current));
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return;
    onResized(widthAt(event, drag.current));
    drag.current = undefined;
    setDragging(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = {
      ArrowLeft: width + KEY_STEP_PX,
      ArrowRight: width - KEY_STEP_PX,
      Home: least,
      End: most,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    settle(fitted(next));
  };

  return (
    <div
      className={dragging ? "side-panel-edge dragging" : "side-panel-edge"}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={least}
      aria-valuemax={most}
      aria-valuenow={width}
      tabIndex={0}
      title={`Drag to resize · double-click for ${standard}px`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => settle(fitted(standard))}
      onKeyDown={onKeyDown}
    >
      <span className="side-panel-edge-readout">
        {width}px · {least}–{most}px
      </span>
    </div>
  );
}

/** A side panel's width as this browser remembers it, in the shape `useSyncExternalStore` reads. */
export interface SidePanelWidthStore {
  width(): number;
  /** The width while the edge moves, not yet remembered. */
  show(width: number): void;
  remember(width: number): void;
  subscribe(onChange: () => void): () => void;
}

/** Keeps the width in local storage, or for this page alone where storage is blocked. */
export function createSidePanelWidthStore(
  storageKey: string,
  { least, standard, most }: SidePanelWidths,
): SidePanelWidthStore {
  let width = rememberedWidth();
  const listeners = new Set<() => void>();

  function rememberedWidth(): number {
    try {
      const stored = Number(localStorage.getItem(storageKey));
      return stored >= least && stored <= most ? stored : standard;
    } catch {
      return standard;
    }
  }
  const show = (next: number): void => {
    width = next;
    for (const listener of listeners) listener();
  };

  return {
    width: () => width,
    show,
    remember: (next) => {
      try {
        localStorage.setItem(storageKey, String(next));
      } catch {
        // Storage is blocked: the width lasts until the page is closed.
      }
      show(next);
    },
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
  };
}
