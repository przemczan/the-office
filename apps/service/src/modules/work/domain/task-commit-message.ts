import type { Task } from "./task.js";
import type { TaskChange } from "./task-changes.js";
import { TaskCommitMessageChanged } from "./task-events.js";
import { TaskRefused } from "./task-refused.js";

/**
 * The commit message, trimmed, of the one commit Publish lands the Task as (spec §2.3): empty clears
 * it back to the default. The Planner suggests it, each Agent Stage updates it and the user edits
 * it, in any state until the Task ends or Publish lands it; it never moves the Task, so a Ready Task
 * stays Ready. Undefined when it already reads so.
 */
export function changeCommitMessage(
  task: Task,
  given: string,
): TaskChange<TaskCommitMessageChanged> | undefined {
  if (task.commitMessagePublishedAt !== undefined) {
    throw new TaskRefused(["Publish has landed the commit message, so it no longer changes."]);
  }
  if (task.state === "done" || task.state === "dropped") {
    throw new TaskRefused(["A Done or Dropped Task keeps its commit message."]);
  }
  const commitMessage = given.trim();
  if (commitMessage === task.commitMessage) return undefined;
  return { task: { ...task, commitMessage }, event: new TaskCommitMessageChanged(task.id) };
}

/** Publish landed the commit message: from now on it is kept as it was published. */
export function publishCommitMessage(
  task: Task,
  at: Date,
): TaskChange<TaskCommitMessageChanged> | undefined {
  if (task.commitMessagePublishedAt !== undefined) return undefined;
  return {
    task: { ...task, commitMessagePublishedAt: at },
    event: new TaskCommitMessageChanged(task.id),
  };
}

/**
 * The commit message Publish lands when none is written: the title, with the Description's first
 * paragraph below it as a short summary.
 */
export function defaultCommitMessage({
  title,
  description,
}: Pick<Task, "title" | "description">): string {
  const summary =
    description
      .trim()
      .split(/\n\s*\n/, 1)[0]
      ?.trim() ?? "";
  return summary === "" ? title : `${title}\n\n${summary}`;
}

/** The message Publish lands: the one written, or the default. */
export function commitMessageOf(
  task: Pick<Task, "title" | "description" | "commitMessage">,
): string {
  return task.commitMessage === "" ? defaultCommitMessage(task) : task.commitMessage;
}
