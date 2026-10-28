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

/**
 * The full-text search over Work's records. A record matches when each word starts a word in it:
 * a Task by its title, Plan, Definition of Done and Tags; an Idea by its title and notes; an
 * Initiative by its name and outcome; a document by its name and text.
 */
export abstract class WorkSearch {
  /** The ids of every Task matching all `words`. */
  abstract matchingTaskIds(words: readonly string[]): Promise<ReadonlySet<string>>;

  /** At most `limit` records of each kind matching all `words`. */
  abstract matches(words: readonly string[], limit: number): Promise<SearchMatches>;
}
