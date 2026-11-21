/** A search reads at most this many words of what the user typed; the rest are left out. */
export const MAX_SEARCH_WORDS = 12;

/**
 * How many records of each kind a search across The Office answers, the best matches first, of
 * those the Project filter shows.
 */
export const SEARCH_RESULT_LIMIT = 50;

/**
 * How much of a document's text the search reads, in bytes: well under what Postgres parses into
 * one searchable value, and far more than a note or a brief.
 */
export const SEARCHED_TEXT_LIMIT = 256 * 1024;

/**
 * The words a search matches, each as the start of a word in the record: letters and digits only,
 * lower-cased, each once. Anything else separates words, so a Tag like `ui-polish` is found by
 * "polish" as Postgres's `simple` parser splits it the same way.
 */
export function searchWords(query: string): string[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words)].slice(0, MAX_SEARCH_WORDS);
}

/**
 * The start of a record's ID when the query is one, full or shortened as people quote it, lower-cased;
 * undefined for anything else. Shorter than 8 characters reads as a word, not an ID.
 */
export function idPrefixOf(query: string): string | undefined {
  const typed = query.trim().toLowerCase();
  return ID_PREFIX.test(typed) ? typed : undefined;
}

/** What the board's search matches a Task by: all its words, or the start of its ID. */
export interface TaskMatch {
  readonly words: readonly string[];
  readonly idPrefix: string | undefined;
}

/** The board's search for `query`; undefined for no words, which matches every Task. */
export function taskMatchOf(query: string): TaskMatch | undefined {
  const words = searchWords(query);
  return words.length === 0 ? undefined : { words, idPrefix: idPrefixOf(query) };
}

/** Hex digits and dashes, from 8 characters up to a whole UUID, starting as an ID does. */
const ID_PREFIX = /^[0-9a-f][0-9a-f-]{7,35}$/;

/** A document's text as the search keeps it: Postgres stores no NUL character in text. */
export function searchedText(text: string): string {
  return text.replaceAll("\u0000", "");
}
