import { isOpen, type Decision } from "./decision.js";
import type { Thread } from "./thread.js";

/**
 * Why a chat Thread can't be deleted yet (spec §2.4.1, "Deleting a chat Thread"): both ends of a
 * Consultation must stay while it is open.
 */
export type DeletionLock = "open-consultation" | "open-call";

/**
 * What keeps a Thread from being deleted: `open-consultation` when it is a Consultation whose
 * Decision still waits on its person (`askedOf` is that Decision), `open-call` when a Decision it
 * asked still waits on the Consultant it was put to. Null when it can be, and for any Thread outside
 * a chat, whose Threads are never deleted.
 */
export function deletionLockOf(
  thread: Pick<Thread, "home" | "roleKey" | "consultation" | "openDecisions">,
  askedOf: Pick<Decision, "answer" | "closedAt" | "putTo"> | undefined,
): DeletionLock | null {
  if (thread.home.kind !== "chat") return null;
  if (thread.consultation && askedOf && isOpen(askedOf) && askedOf.putTo === thread.roleKey) {
    return "open-consultation";
  }
  if (thread.openDecisions.some((decision) => isOpen(decision) && decision.putTo !== undefined)) {
    return "open-call";
  }
  return null;
}

/** Why the Thread can't be deleted, in words for the user. */
export function deletionLockWords(lock: DeletionLock): string {
  return lock === "open-consultation"
    ? "its Consultation is still waiting on the person"
    : "its call to a Consultant is still out";
}
