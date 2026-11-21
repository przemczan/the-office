import type { TaskSummary } from "@the-office/contracts";

/**
 * A word as the service keeps it as a Tag (the Work module's `task-tags.ts`): lower-case, spaces
 * made hyphens; empty when there is nothing to keep. Shown before saving, so the chip reads as saved.
 */
export function tagOf(word: string): string {
  return word.trim().toLowerCase().replace(/\s+/g, "-");
}

/** The Tags with the word added last, unless it is empty or there already. */
export function withTag(tags: readonly string[], word: string): readonly string[] {
  const tag = tagOf(word);
  return tag === "" || tags.includes(tag) ? tags : [...tags, tag];
}

/** Every Tag on one of the Tasks, each once, in alphabetical order. */
export function tagsInUse(tasks: readonly TaskSummary[]): string[] {
  return [...new Set(tasks.flatMap((task) => task.tags))].toSorted();
}
