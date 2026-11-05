import type { Task } from "./task.js";
import type { TaskChange } from "./task-changes.js";
import { TaskDescriptionChanged } from "./task-events.js";
import { TaskRefused } from "./task-refused.js";
import { NOT_STARTED_STATES } from "./task-states.js";

/** What an empty Description reads, to the user and to the Agents alike. */
export const NO_DESCRIPTION = "None: the title is all there is.";

/**
 * The user's Description, trimmed; empty leaves the title all there is (spec §2.1). It is edited
 * until the Task starts, as the Plan is; undefined when it already reads so.
 */
export function changeDescription(
  task: Task,
  given: string,
): TaskChange<TaskDescriptionChanged> | undefined {
  if (!NOT_STARTED_STATES.includes(task.state)) {
    throw new TaskRefused(["A Task keeps its Description once it has started."]);
  }
  const description = given.trim();
  if (description === task.description) return undefined;
  return { task: { ...task, description }, event: new TaskDescriptionChanged(task.id) };
}
