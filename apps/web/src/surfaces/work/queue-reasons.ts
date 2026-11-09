// The service words each blocker's reason this way: `blockedProblems` in
// apps/service/src/modules/work/domain/task-dependencies.ts.
const BLOCKER_REASON_START = "Blocked by ";

/**
 * The reasons a queued Task waits for, but for its blockers, in their order: a board card names
 * its blockers in its own "Blocked by" line already.
 */
export function reasonsBesideBlockers(reasons: readonly string[]): readonly string[] {
  return reasons.filter((reason) => !reason.startsWith(BLOCKER_REASON_START));
}
