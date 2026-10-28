import type { Task } from "./task.js";
import type { TaskChange } from "./task-changes.js";
import { TaskTagsChanged } from "./task-events.js";
import { TaskRefused } from "./task-refused.js";

export const MAX_TAGS = 12;
export const MAX_TAG_LENGTH = 32;

/**
 * A Tag is one lower-case word, so "Bug" and "bug " are the same Tag; spaces inside become
 * hyphens. The Tags keep the order given, each once, the empty ones left out.
 */
export function normalizedTags(tags: readonly string[]): string[] {
  const words = tags.map((tag) => tag.trim().toLowerCase().replace(/\s+/g, "-"));
  return [...new Set(words.filter((word) => word !== ""))];
}

/** Why normalized Tags can't be a Task's. */
export function tagsProblems(tags: readonly string[]): string[] {
  const tooLong = tags.filter((tag) => tag.length > MAX_TAG_LENGTH);
  return [
    ...(tags.length > MAX_TAGS ? [`A Task can have at most ${MAX_TAGS} Tags.`] : []),
    ...tooLong.map((tag) => `The Tag "${tag}" is longer than ${MAX_TAG_LENGTH} characters.`),
  ];
}

/** Sets the Task's Tags in any state; undefined when they already are. Refuses with every reason. */
export function changeTags(
  task: Task,
  given: readonly string[],
): TaskChange<TaskTagsChanged> | undefined {
  const tags = normalizedTags(given);
  const problems = tagsProblems(tags);
  if (problems.length > 0) throw new TaskRefused(problems);
  if (tags.length === task.tags.length && tags.every((tag, at) => task.tags[at] === tag)) {
    return undefined;
  }
  return { task: { ...task, tags }, event: new TaskTagsChanged(task.id, tags) };
}
