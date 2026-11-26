import { useSyncExternalStore } from "react";
import {
  DEFAULT_ROUTE_DRAWING,
  ROUTE_DRAWINGS,
  type RouteDrawing,
} from "./flow-routes/route-drawer.ts";

/**
 * How the flow's routes are drawn is this browser's choice, never sent to the service
 * (docs/design/pipeline-route-drawing.html, "The switch"): every flow on the page follows a change
 * at once, as does another tab's.
 */
export const ROUTE_DRAWING_STORAGE_KEY = "the-office.flow-route-drawing";

/** The Route drawing switch's words for each way of drawing. */
export const ROUTE_DRAWING_WORDS: Readonly<Record<RouteDrawing, string>> = {
  "right-angles": "Right angles",
  curves: "Curves",
  "straight-lines": "Straight lines",
};

interface RouteDrawingStore {
  drawing(): RouteDrawing;
  choose(next: RouteDrawing): void;
  subscribe(onChange: () => void): () => void;
}

/** Keeps the choice in local storage, or for this page alone where storage is blocked. */
function createRouteDrawingStore(): RouteDrawingStore {
  let drawing = storedDrawing();
  const listeners = new Set<() => void>();

  const update = (next: RouteDrawing): void => {
    if (next === drawing) return;
    drawing = next;
    for (const listener of listeners) listener();
  };
  // Another tab chose another way of drawing.
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== ROUTE_DRAWING_STORAGE_KEY) return;
    update(storedDrawing());
  };

  return {
    drawing: () => drawing,
    choose: (next) => {
      try {
        localStorage.setItem(ROUTE_DRAWING_STORAGE_KEY, next);
      } catch {
        // Storage is blocked: the choice lasts until the page is closed.
      }
      update(next);
    },
    subscribe: (onChange) => {
      if (listeners.size === 0) window.addEventListener("storage", onStorage);
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
        if (listeners.size === 0) window.removeEventListener("storage", onStorage);
      };
    },
  };
}

/** A stored value that isn't one of the three counts as the default. */
function storedDrawing(): RouteDrawing {
  try {
    const stored = localStorage.getItem(ROUTE_DRAWING_STORAGE_KEY);
    return ROUTE_DRAWINGS.find((drawing) => drawing === stored) ?? DEFAULT_ROUTE_DRAWING;
  } catch {
    return DEFAULT_ROUTE_DRAWING;
  }
}

const store = createRouteDrawingStore();

/** How this browser draws the flow's routes, and a way to choose another. */
export function useRouteDrawing(): [RouteDrawing, (next: RouteDrawing) => void] {
  const drawing = useSyncExternalStore(store.subscribe, store.drawing);
  return [drawing, store.choose];
}
