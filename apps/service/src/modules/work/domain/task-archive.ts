import type { Task } from "./task.js";
import type { TaskChange } from "./task-changes.js";
import { TaskArchived, TaskRestored } from "./task-events.js";
import { TaskRefused } from "./task-refused.js";
import { TASK_STATE_NAMES } from "./task-states.js";

/** Whether the Task is in the Archive (spec §2.1): a mark beside its state, never a state. */
export function isArchived(task: Task): boolean {
  return task.archivedAt !== undefined;
}

/**
 * Takes a Done or Dropped Task off the board, its state untouched; refused in any other state, and
 * undefined when it is already archived. Both states are final, so the mark never outlives them.
 */
export function archiveTask(task: Task, at: Date): TaskChange<TaskArchived> | undefined {
  if (task.state !== "done" && task.state !== "dropped") {
    throw new TaskRefused([
      `Only a Done or Dropped Task can be archived; this one is in ${TASK_STATE_NAMES[task.state]}.`,
    ]);
  }
  if (isArchived(task)) return undefined;
  return { task: { ...task, archivedAt: at }, event: new TaskArchived(task.id, at) };
}

/**
 * Returns an archived Task to the board in the state it had, keeping the moment, from which
 * archiving it automatically counts again. Undefined when it isn't archived.
 */
export function restoreTask(task: Task, at: Date): TaskChange<TaskRestored> | undefined {
  if (!isArchived(task)) return undefined;
  return {
    task: { ...task, archivedAt: undefined, restoredAt: at },
    event: new TaskRestored(task.id, at),
  };
}
