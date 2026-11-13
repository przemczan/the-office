import type { QueuedTask } from "@the-office/contracts";

// The service words each blocker's reason this way: `blockedProblems` in
// apps/service/src/modules/work/domain/task-dependencies.ts.
const BLOCKER_REASON_START = "Blocked by ";

/** One wait that holds a queued Task: its full reason and its short reason. */
export interface QueueReason {
  readonly reason: string;
  readonly short: string;
}

/**
 * The waits a queued Task waits for, but for its blockers, in their order: a board card names its
 * blockers in its own "Blocked by" line already. A Task queued before short reasons has none until
 * the queue's next release, so its full reason stands in.
 */
export function reasonsBesideBlockers({
  reasons,
  shortReasons,
}: Pick<QueuedTask, "reasons" | "shortReasons">): readonly QueueReason[] {
  return reasons
    .map((reason, at) => ({ reason, short: shortReasons[at] ?? reason }))
    .filter(({ reason }) => !reason.startsWith(BLOCKER_REASON_START));
}

/** The short reasons, each once: the same cap on two engines reads the same. */
export function distinctShortReasons(reasons: readonly QueueReason[]): readonly string[] {
  return [...new Set(reasons.map(({ short }) => short))];
}
