import { useSyncExternalStore } from "react";
import { z } from "zod";

/** Which blocks of a record are folded is this browser's choice, never sent to the service. */
export const RECORD_FOLDS_STORAGE_KEY = "the-office.record-folds";

/** The record whose page holds the blocks: each Task and Initiative remembers its own. */
export interface FoldedRecord {
  readonly kind: "task" | "initiative";
  readonly id: string;
}

const rememberedFoldsSchema = z.record(z.string(), z.record(z.string(), z.boolean()));

/** Whether each block the user folded or unfolded is open, by record, then by block. */
type RememberedFolds = z.infer<typeof rememberedFoldsSchema>;

/** The folds' memory, in the shape React's `useSyncExternalStore` reads. */
export interface RecordFoldsStore {
  remembered(): RememberedFolds;
  remember(record: FoldedRecord, block: string, open: boolean): void;
  subscribe(onChange: () => void): () => void;
}

function recordKeyOf({ kind, id }: FoldedRecord): string {
  return `${kind}:${id}`;
}

/** Keeps the folds in local storage, or for this page alone where storage is blocked. */
export function createRecordFoldsStore(): RecordFoldsStore {
  let remembered = storedFolds();
  const listeners = new Set<() => void>();

  const update = (next: RememberedFolds): void => {
    remembered = next;
    for (const listener of listeners) listener();
  };
  // Another tab folded a block.
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== RECORD_FOLDS_STORAGE_KEY) return;
    update(storedFolds());
  };

  return {
    remembered: () => remembered,
    remember: (record, block, open) => {
      const recordKey = recordKeyOf(record);
      const next = { ...remembered, [recordKey]: { ...remembered[recordKey], [block]: open } };
      try {
        localStorage.setItem(RECORD_FOLDS_STORAGE_KEY, JSON.stringify(next));
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
    const stored = localStorage.getItem(RECORD_FOLDS_STORAGE_KEY);
    if (stored === null) return {};
    return rememberedFoldsSchema.parse(JSON.parse(stored));
  } catch {
    return {};
  }
}

const store = createRecordFoldsStore();

/** One block's fold, as `RecordFold` draws it. */
export interface Fold {
  readonly isOpen: boolean;
  readonly toggle: () => void;
  /** For what the user starts from the fold's side and must see, such as its editor. */
  readonly open: () => void;
}

/** A block's fold as this browser remembers it; until the user folds it, as `startsOpen` says. */
export function useFold(record: FoldedRecord, block: string, startsOpen: boolean): Fold {
  const remembered = useSyncExternalStore(store.subscribe, store.remembered);
  const isOpen = remembered[recordKeyOf(record)]?.[block] ?? startsOpen;
  return {
    isOpen,
    toggle: () => store.remember(record, block, !isOpen),
    open: () => store.remember(record, block, true),
  };
}
