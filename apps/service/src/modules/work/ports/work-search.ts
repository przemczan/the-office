import type { Attachment } from "../domain/attachment.js";
import type { Idea } from "../domain/idea.js";
import type { Initiative } from "../domain/initiative.js";
import type { Task } from "../domain/task.js";

/** The records matching a search, by kind, the best matches first. */
export interface SearchMatches {
  readonly tasks: readonly Task[];
  readonly ideas: readonly Idea[];
  readonly initiatives: readonly Initiative[];
  /** Document Attachments only. */
  readonly documents: readonly Attachment[];
}

/** The records whose ID starts with what the user typed, by kind, in ID order. */
export type IdMatches = Omit<SearchMatches, "documents">;

/**
 * The full-text search over Work's records. A record matches when each word starts a word in it:
 * a Task by its title, Plan, Definition of Done and Tags; an Idea by its title and notes; an
 * Initiative by its name and outcome; a document by its name and text. Tasks, Ideas and
 * Initiatives are also found by the start of their ID.
 */
export abstract class WorkSearch {
  /** Every Task, Idea and Initiative whose ID starts with `idPrefix`, archived ones too. */
  abstract startingWithId(idPrefix: string): Promise<IdMatches>;

  /** The ids of every Task matching all `words`. */
  abstract matchingTaskIds(words: readonly string[]): Promise<ReadonlySet<string>>;

  /** The ids of every Initiative matching all `words`, archived ones too. */
  abstract matchingInitiativeIds(words: readonly string[]): Promise<ReadonlySet<string>>;

  /** Every record of each kind matching all `words`. */
  abstract matches(words: readonly string[]): Promise<SearchMatches>;
}
