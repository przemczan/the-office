import { BY_THE_DAILY_RUN, type ArchivedBy, type Author } from "./author.js";
import type { Task } from "./task.js";
import type { TaskChange } from "./task-changes.js";
import { TaskArchived, TaskRestored } from "./task-events.js";
import { TaskRefused } from "./task-refused.js";
import { TASK_STATE_NAMES } from "./task-states.js";

/** The Archive period until Settings saves one, in days (spec §2.1). */
export const DEFAULT_ARCHIVE_PERIOD = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether the Task is in the Archive (spec §2.1): a mark beside its state, never a state. */
export function isArchived(task: Pick<Task, "archivedAt">): boolean {
  return task.archivedAt !== undefined;
}

/**
 * Takes a Done or Dropped Task off the board, its state untouched; refused in any other state, and
 * undefined when it is already archived. Both states are final, so the mark never outlives them.
 */
export function archiveTask(
  task: Task,
  at: Date,
  by: ArchivedBy,
): TaskChange<TaskArchived> | undefined {
  if (task.state !== "done" && task.state !== "dropped") {
    throw new TaskRefused([
      `Only a Done or Dropped Task can be archived; this one is in ${TASK_STATE_NAMES[task.state]}.`,
    ]);
  }
  if (isArchived(task)) return undefined;
  return {
    task: { ...task, archivedAt: at, archivedBy: by },
    event: new TaskArchived(task.id, at),
  };
}

/**
 * Returns an archived Task to the board in the state it had, keeping the moment, from which
 * archiving it automatically counts again. Undefined when it isn't archived.
 */
export function restoreTask(
  task: Task,
  at: Date,
  by: Author,
): TaskChange<TaskRestored> | undefined {
  if (!isArchived(task)) return undefined;
  return {
    task: { ...task, archivedAt: undefined, archivedBy: undefined, restoredAt: at, restoredBy: by },
    event: new TaskRestored(task.id, at),
  };
}

/** The moment from which a Task finished `archivePeriod` days before `now` is due for the Archive. */
export function archiveCutoff(now: Date, archivePeriod: number): Date {
  return new Date(now.getTime() - archivePeriod * DAY_MS);
}

/**
 * Where the Task's Archive period starts: the later of when it ended and its last Restore. A Task
 * whose end was never recorded counts from its creation, which can only be earlier than its real
 * end.
 */
export function archivePeriodStart(task: Task): Date {
  const finishedAt = task.endedAt ?? task.createdAt;
  const { restoredAt } = task;
  return restoredAt && restoredAt > finishedAt ? restoredAt : finishedAt;
}

/**
 * Archives a Done or Dropped Task on the board whose Archive period started before `cutoff`, as
 * The Office's daily run; undefined for any other Task, which stays as it is.
 */
export function archiveIfDue(
  task: Task,
  cutoff: Date,
  at: Date,
): TaskChange<TaskArchived> | undefined {
  if (!isFinishedOnTheBoard(task)) return undefined;
  if (archivePeriodStart(task) >= cutoff) return undefined;
  return archiveTask(task, at, BY_THE_DAILY_RUN);
}

/** A Done or Dropped Task not archived: the ones the daily run weighs. */
export function isFinishedOnTheBoard(task: Task): boolean {
  return (task.state === "done" || task.state === "dropped") && !isArchived(task);
}
