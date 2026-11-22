import type { PullRequest, QueuedTask, TaskSummary } from "@the-office/contracts";
import { pullRequestName } from "../../shell/code-host-words.ts";

/** Whether The Office made the Task to resolve the conflicts of another Task's pull request. */
export function isConflictResolutionTask(task: Pick<TaskSummary, "madeFor">): boolean {
  return task.madeFor === "resolve-conflicts";
}

/** Every Conflict resolution Task naming the Task, newest first. */
export function conflictResolutionsOf(
  taskId: string,
  tasks: readonly TaskSummary[],
): TaskSummary[] {
  return tasks
    .filter((each) => isConflictResolutionTask(each) && each.resolvesTaskId === taskId)
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The Task's Conflict resolution Task while one is open: neither Done nor Dropped. */
export function openConflictResolutionOf(
  taskId: string,
  tasks: readonly TaskSummary[],
): TaskSummary | undefined {
  return conflictResolutionsOf(taskId, tasks).find(
    ({ state }) => state !== "done" && state !== "dropped",
  );
}

export const RESOLVE_CONFLICTS_ACTION = "Resolve conflicts";
export const RESOLVE_CONFLICTS_TITLE =
  "Make a Conflict resolution Task, which merges the base branch into this pull request's branch and resolves the conflicts, then start it.";
export const RESOLVING = "Resolving:";
export const CONFLICTS_RESOLVED_BY = "Conflicts resolved by:";
export const RESOLVES_THE_CONFLICTS_OF = "Resolves the conflicts of:";

/** "No Conflict resolution Task was made for #42 Add the sign-in page". */
export function resolveRefusedTitle(pullRequest: Pick<PullRequest, "number" | "title">): string {
  return `No Conflict resolution Task was made for ${pullRequestName(pullRequest)}`;
}

export const START_REFUSED_TITLE = "The Conflict resolution Task was made but didn't start";
export const START_REFUSED_HINT = "It stays Ready; start it from its page once nothing holds it.";

/** Start's own words for a queued Task: "… is queued, place 2: …". */
export function queuedWords(task: Pick<TaskSummary, "title">, queued: QueuedTask): string {
  return `${task.title} is queued, place ${queued.place}: ${queued.reasons.join(" ")}`;
}
