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

/** A document's text as the search keeps it: Postgres stores no NUL character in text. */
export function searchedText(text: string): string {
  return text.replaceAll("\u0000", "");
}
