import { useSyncExternalStore } from "react";

const deleted = new Set<string>();
const listeners = new Set<() => void>();

/** Remembers chat Threads this browser heard were deleted, until the page is loaded again. */
export function rememberDeletedThreads(threadIds: readonly string[]): void {
  let changed = false;
  for (const threadId of threadIds) {
    if (!deleted.has(threadId)) {
      deleted.add(threadId);
      changed = true;
    }
  }
  if (changed) for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether the Thread was deleted, as this browser has heard; read again when that changes. */
export function useThreadDeleted(threadId: string): boolean {
  return useSyncExternalStore(subscribe, () => deleted.has(threadId));
}
