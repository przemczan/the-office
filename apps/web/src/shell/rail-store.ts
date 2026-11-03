import { useSyncExternalStore } from "react";

/** Whether the rail is expanded is this browser's choice, never sent to the service. */
export const RAIL_EXPANDED_STORAGE_KEY = "the-office.rail-expanded";

/** Whether the rail shows its labels, in the shape React's `useSyncExternalStore` reads. */
export interface RailStore {
  /** True when the rail shows each item's label beside its icon. */
  expanded(): boolean;
  choose(expanded: boolean): void;
  subscribe(onChange: () => void): () => void;
}

/** Keeps the choice in local storage, or for this page alone where storage is blocked. */
export function createRailStore(): RailStore {
  let expanded = storedExpanded();
  const listeners = new Set<() => void>();

  const update = (next: boolean): void => {
    expanded = next;
    for (const listener of listeners) listener();
  };
  // Another tab expanded or collapsed its rail.
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== RAIL_EXPANDED_STORAGE_KEY) return;
    update(storedExpanded());
  };

  return {
    expanded: () => expanded,
    choose: (next) => {
      try {
        localStorage.setItem(RAIL_EXPANDED_STORAGE_KEY, JSON.stringify(next));
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

function storedExpanded(): boolean {
  try {
    return localStorage.getItem(RAIL_EXPANDED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

const store = createRailStore();

export interface RailExpansion {
  readonly expanded: boolean;
  readonly toggle: () => void;
}

/** The rail's state as this browser keeps it: icon-only until the user expands it. */
export function useRailExpansion(): RailExpansion {
  const expanded = useSyncExternalStore(store.subscribe, store.expanded);
  return { expanded, toggle: () => store.choose(!expanded) };
}
