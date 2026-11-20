import { authorWords, type Author } from "./author.js";
import type { Task } from "./task.js";
import type { TaskChange } from "./task-changes.js";
import { TaskPullRequestEnded, TaskPullRequestReopened } from "./task-events.js";

/** How a pull request was merged, from Work › Pull requests. */
export type PullRequestMergeMethod = "merge" | "squash" | "rebase";

/** Who ended a Task's pull request: a user, from Work › Pull requests, or someone on its code host. */
export type PullRequestEndedBy = Author | { readonly kind: "code-host"; readonly name: string };

/**
 * How the Task's pull request ended, merged or closed: a mark kept beside its state, never one,
 * cleared when the pull request shows up open again.
 */
export interface PullRequestEnd {
  readonly outcome: "merged" | "closed";
  readonly number: number;
  readonly url: string;
  readonly at: Date;
  /** How it was merged; undefined when it was closed, or merged on the code host. */
  readonly method: PullRequestMergeMethod | undefined;
  readonly by: PullRequestEndedBy;
}

/**
 * Records how the Task's pull request ended, in any state, archived too; it never moves the Task.
 * Undefined when the same outcome of the same pull request is recorded already, so a second report
 * of one end announces nothing.
 */
export function recordPullRequestEnd(
  task: Task,
  end: PullRequestEnd,
): TaskChange<TaskPullRequestEnded> | undefined {
  const recorded = task.pullRequestEnd;
  if (recorded?.number === end.number && recorded.outcome === end.outcome) return undefined;
  return {
    task: { ...task, pullRequestEnd: end },
    event: new TaskPullRequestEnded(task.id, end.outcome, end.number, end.at),
  };
}

/**
 * Clears the end recorded for pull request `number`, which shows up open again; undefined when the
 * Task has no end recorded for it.
 */
export function clearPullRequestEnd(
  task: Task,
  number: number,
  at: Date,
): TaskChange<TaskPullRequestReopened> | undefined {
  if (task.pullRequestEnd?.number !== number) return undefined;
  return {
    task: { ...task, pullRequestEnd: undefined },
    event: new TaskPullRequestReopened(task.id, number, at),
  };
}

/**
 * The record's line: "Pull request #12 (url) merged (squash) by the user Ann Lee on …", or "…
 * closed on GitHub on …", the code host named as the end kept it.
 */
export function pullRequestEndWords(end: PullRequestEnd): string {
  const how = end.method === undefined ? "" : ` (${end.method})`;
  const by = end.by.kind === "code-host" ? `on ${end.by.name}` : `by ${authorWords(end.by)}`;
  return `Pull request #${end.number} (${end.url}) ${end.outcome}${how} ${by} on ${end.at.toISOString()}`;
}
