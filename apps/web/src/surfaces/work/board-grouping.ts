import { z } from "zod";

/**
 * How the board is laid out, kept in its address beside the filters but apart from them: it narrows
 * nothing, so Clear and the Saved views leave it as it is.
 */
export interface BoardGrouping {
  readonly group?: "initiative";
}

/** The board's grouping from its address, leaving out any other value. */
export function boardGroupingOf(search: Record<string, unknown>): BoardGrouping {
  return search["group"] === "initiative" ? { group: "initiative" } : {};
}

/**
 * Whether the board is grouped by Initiative is this browser's choice too, never sent to the service:
 * a board opened without `group` in its address is grouped as last chosen here.
 */
export const BOARD_GROUPING_STORAGE_KEY = "the-office.board-grouping";

const rememberedGroupingSchema = z.object({ grouped: z.boolean() });

/** The remembered grouping, in the shape React's `useSyncExternalStore` reads. */
export interface BoardGroupingStore {
  /** Whether the board was last grouped by Initiative in this browser. */
  current(): boolean;
  remember(grouped: boolean): void;
  subscribe(onChange: () => void): () => void;
}

/** Keeps the grouping in local storage, or for this page alone where storage is blocked. */
export function createBoardGroupingStore(): BoardGroupingStore {
  let grouped = storedGrouping();
  const listeners = new Set<() => void>();

  const update = (next: boolean): void => {
    grouped = next;
    for (const listener of listeners) listener();
  };
  // Another tab switched the grouping.
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== BOARD_GROUPING_STORAGE_KEY) return;
    update(storedGrouping());
  };

  return {
    current: () => grouped,
    remember: (next) => {
      try {
        localStorage.setItem(BOARD_GROUPING_STORAGE_KEY, JSON.stringify({ grouped: next }));
      } catch {
        // Storage is blocked: the grouping lasts until the page is closed.
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

function storedGrouping(): boolean {
  try {
    const stored = localStorage.getItem(BOARD_GROUPING_STORAGE_KEY);
    if (stored === null) return false;
    return rememberedGroupingSchema.parse(JSON.parse(stored)).grouped;
  } catch {
    return false;
  }
}
