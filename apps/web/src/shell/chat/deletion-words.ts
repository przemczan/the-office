import type { ThreadSummary } from "@the-office/contracts";

/** Why a chat Thread can't be deleted yet, in the Thread list's row and the open Thread's head. */
export interface DeletionLockWords {
  /** In the row, beside the date. */
  readonly short: string;
  /** The tooltip. */
  readonly tip: string;
  /** Under the tooltip: when it can. */
  readonly detail: string;
}

/**
 * The words of a lock (spec §2.4.1, "Deleting a chat Thread"). `asker` is who put the question,
 * when The Office knows them; a call the person made names no one the Thread knows, so it says
 * "someone".
 */
export function deletionLockWords(
  lock: NonNullable<ThreadSummary["deletionLock"]>,
  personName: string,
  askerName: string | undefined,
): DeletionLockWords {
  switch (lock) {
    case "open-consultation":
      return {
        short: "Open Consultation",
        tip: `${askerName === undefined ? "The" : `${askerName}'s`} call waits on ${personName}'s answer`,
        detail: `It can be deleted once ${personName} answers it.`,
      };
    case "open-call":
      return {
        short: "Call open",
        tip: `${personName} is waiting on someone's answer here`,
        detail: "It can be deleted once they answer.",
      };
  }
}

/** The confirmation window's title. */
export function deleteTitle(count: number, personName: string, fromHead: boolean): string {
  if (fromHead) return `Delete this Thread with ${personName}?`;
  return count === 1
    ? `Delete 1 Thread with ${personName}?`
    : `Delete ${count} Threads with ${personName}?`;
}

/** The toast after it. */
export function deletedToast(count: number): string {
  return count === 1 ? "Thread deleted" : `${count} Threads deleted`;
}
