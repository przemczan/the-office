import { useSyncExternalStore } from "react";

/** Whether Details is on is this browser's choice, never sent to the service. */
export const DETAILS_STORAGE_KEY = "the-office.details";

/** The Details switch, in the shape React's `useSyncExternalStore` reads. */
export interface DetailsStore {
  /** True when a Thread's log shows tool activity and the context lines. */
  on(): boolean;
  choose(on: boolean): void;
  subscribe(onChange: () => void): () => void;
}

/** Keeps the choice in local storage, or for this page alone where storage is blocked. */
export function createDetailsStore(): DetailsStore {
  let on = storedOn();
  const listeners = new Set<() => void>();

  const update = (next: boolean): void => {
    on = next;
    for (const listener of listeners) listener();
  };
  // Another tab switched it.
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== DETAILS_STORAGE_KEY) return;
    update(storedOn());
  };

  return {
    on: () => on,
    choose: (next) => {
      try {
        localStorage.setItem(DETAILS_STORAGE_KEY, JSON.stringify(next));
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

function storedOn(): boolean {
  try {
    return localStorage.getItem(DETAILS_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

const store = createDetailsStore();

export interface Details {
  readonly on: boolean;
  readonly choose: (on: boolean) => void;
}

/** The one Details setting of this browser, for every Thread's log: off until the user turns it on. */
export function useDetails(): Details {
  return { on: useSyncExternalStore(store.subscribe, store.on), choose: store.choose };
}
