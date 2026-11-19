import type { Task } from "./task.js";
import type { TaskChange } from "./task-changes.js";
import { TaskDescriptionChanged, TaskTitleChanged } from "./task-events.js";
import { TaskRefused } from "./task-refused.js";
import { NOT_STARTED_STATES } from "./task-states.js";
import { titleProblem } from "./title.js";

/** What an empty Description reads, to the user and to the Agents alike. */
export const NO_DESCRIPTION = "None: the title is all there is.";

/** The Description as a section of a Brief: the Planner's and every Agent Stage's (spec §2.5). */
export function descriptionSection(description: string): string {
  return `## What the user wants, in their own words\n\n${descriptionWords(description)}`;
}

/** The Description as an Agent reads it, an empty one saying so. */
export function descriptionWords(description: string): string {
  return description === "" ? NO_DESCRIPTION : description;
}

/**
 * The title, trimmed, judged as a new Task's is. Like the Description, it changes until the Task
 * starts; undefined when it already reads so.
 */
export function changeTitle(task: Task, given: string): TaskChange<TaskTitleChanged> | undefined {
  if (!NOT_STARTED_STATES.includes(task.state)) {
    throw new TaskRefused(["A Task keeps its title once it has started."]);
  }
  const problem = titleProblem(given, "Task");
  if (problem) throw new TaskRefused([problem]);
  const title = given.trim();
  if (title === task.title) return undefined;
  return { task: { ...task, title }, event: new TaskTitleChanged(task.id) };
}

/**
 * The Description, trimmed; empty leaves the title all there is (spec §2.1). It is edited
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
