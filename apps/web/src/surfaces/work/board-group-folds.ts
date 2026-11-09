import { useSyncExternalStore } from "react";
import type { Initiative } from "@the-office/contracts";
import { z } from "zod";
import { hasEnded, type BoardGroup } from "./board-groups.ts";

/** Which of the board's groups are folded is this browser's choice, never sent to the service. */
export const BOARD_GROUP_FOLDS_STORAGE_KEY = "the-office.board-group-folds";

const rememberedFoldsSchema = z.record(z.string(), z.boolean());

/** Whether each group the user folded or unfolded is open, by its key. */
type RememberedFolds = z.infer<typeof rememberedFoldsSchema>;

/** The folds' memory, in the shape React's `useSyncExternalStore` reads. */
export interface BoardGroupFoldsStore {
  remembered(): RememberedFolds;
  remember(groupKeys: readonly string[], open: boolean): void;
  subscribe(onChange: () => void): () => void;
}

/** Keeps the folds in local storage, or for this page alone where storage is blocked. */
export function createBoardGroupFoldsStore(): BoardGroupFoldsStore {
  let remembered = storedFolds();
  const listeners = new Set<() => void>();

  const update = (next: RememberedFolds): void => {
    remembered = next;
    for (const listener of listeners) listener();
  };
  // Another tab folded a group.
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== BOARD_GROUP_FOLDS_STORAGE_KEY) return;
    update(storedFolds());
  };

  return {
    remembered: () => remembered,
    remember: (groupKeys, open) => {
      const next = { ...remembered, ...Object.fromEntries(groupKeys.map((key) => [key, open])) };
      try {
        localStorage.setItem(BOARD_GROUP_FOLDS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage is blocked: the folds last until the page is closed.
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

function storedFolds(): RememberedFolds {
  try {
    const stored = localStorage.getItem(BOARD_GROUP_FOLDS_STORAGE_KEY);
    if (stored === null) return {};
    return rememberedFoldsSchema.parse(JSON.parse(stored));
  } catch {
    return {};
  }
}

/** A Done or Dropped Initiative's group starts folded, as nothing in it waits on anyone. */
export function startsOpen({
  initiative,
}: {
  readonly initiative: Pick<Initiative, "state"> | undefined;
}): boolean {
  return initiative === undefined || !hasEnded(initiative);
}

export interface BoardGroupFolds {
  readonly isOpen: (group: BoardGroup) => boolean;
  readonly toggle: (group: BoardGroup) => void;
  /** Folds or unfolds every group given, as Fold all and Unfold all do. */
  readonly setAll: (groups: readonly BoardGroup[], open: boolean) => void;
}

const store = createBoardGroupFoldsStore();

/** The groups' folds as this browser remembers them; until the user folds one, as `startsOpen` says. */
export function useBoardGroupFolds(): BoardGroupFolds {
  const remembered = useSyncExternalStore(store.subscribe, store.remembered);
  const isOpen = (group: BoardGroup): boolean => remembered[group.key] ?? startsOpen(group);
  return {
    isOpen,
    toggle: (group) => store.remember([group.key], !isOpen(group)),
    setAll: (groups, open) =>
      store.remember(
        groups.map(({ key }) => key),
        open,
      ),
  };
}
