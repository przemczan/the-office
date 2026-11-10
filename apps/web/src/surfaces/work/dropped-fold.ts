import { useSyncExternalStore } from "react";

/**
 * Whether the Initiatives board's Dropped fold is open is this browser's choice, never in the
 * address nor sent to the service: someone going in and out of Initiative pages keeps it.
 */
export const DROPPED_FOLD_STORAGE_KEY = "the-office.initiatives-dropped-fold";

/** The fold's memory, in the shape React's `useSyncExternalStore` reads. */
export interface DroppedFoldStore {
  open(): boolean;
  remember(open: boolean): void;
  subscribe(onChange: () => void): () => void;
}

/** Keeps the fold in local storage, or for this page alone where storage is blocked. */
export function createDroppedFoldStore(): DroppedFoldStore {
  let open = storedOpen();
  const listeners = new Set<() => void>();

  const update = (next: boolean): void => {
    open = next;
    for (const listener of listeners) listener();
  };
  // Another tab folded or unfolded it.
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== DROPPED_FOLD_STORAGE_KEY) return;
    update(storedOpen());
  };

  return {
    open: () => open,
    remember: (next) => {
      try {
        localStorage.setItem(DROPPED_FOLD_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage is blocked: the fold lasts until the page is closed.
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

function storedOpen(): boolean {
  try {
    return localStorage.getItem(DROPPED_FOLD_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

const store = createDroppedFoldStore();

export interface DroppedFold {
  readonly open: boolean;
  readonly toggle: () => void;
}

/** The Dropped fold at the foot of Done: folded until the user opens it, then as they left it. */
export function useDroppedFold(): DroppedFold {
  const open = useSyncExternalStore(store.subscribe, store.open);
  return { open, toggle: () => store.remember(!open) };
}
