import { useSyncExternalStore } from "react";
import { z } from "zod";

/** How the Sessions section groups its rows: by person or by subject. */
export const ACTIVITY_GROUPINGS = ["person", "subject"] as const;
export type ActivityGrouping = (typeof ACTIVITY_GROUPINGS)[number];

/** The grouping is this browser's choice, never sent to the service. */
export const ACTIVITY_GROUPING_STORAGE_KEY = "the-office.activity-grouping";

const DEFAULT_GROUPING: ActivityGrouping = "person";
const groupingSchema = z.enum(ACTIVITY_GROUPINGS);

export interface ActivityGroupingStore {
  current(): ActivityGrouping;
  remember(grouping: ActivityGrouping): void;
  subscribe(onChange: () => void): () => void;
}

/** Keeps the grouping in local storage, or for this page alone where storage is blocked. */
export function createActivityGroupingStore(): ActivityGroupingStore {
  let grouping = storedGrouping();
  const listeners = new Set<() => void>();
  const update = (next: ActivityGrouping): void => {
    grouping = next;
    for (const listener of listeners) listener();
  };
  // Another tab switched the grouping.
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== ACTIVITY_GROUPING_STORAGE_KEY) return;
    update(storedGrouping());
  };
  return {
    current: () => grouping,
    remember: (next) => {
      try {
        localStorage.setItem(ACTIVITY_GROUPING_STORAGE_KEY, JSON.stringify(next));
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

function storedGrouping(): ActivityGrouping {
  try {
    const stored = localStorage.getItem(ACTIVITY_GROUPING_STORAGE_KEY);
    if (stored === null) return DEFAULT_GROUPING;
    return groupingSchema.parse(JSON.parse(stored));
  } catch {
    return DEFAULT_GROUPING;
  }
}

const groupingStore = createActivityGroupingStore();

export function useActivityGrouping(): readonly [
  ActivityGrouping,
  (grouping: ActivityGrouping) => void,
] {
  const grouping = useSyncExternalStore(groupingStore.subscribe, groupingStore.current);
  return [grouping, groupingStore.remember];
}
