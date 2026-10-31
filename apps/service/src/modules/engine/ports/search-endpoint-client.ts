/** One result of a web search, as the search endpoint lists it. */
export interface SearchResult {
  readonly title: string;
  readonly url: string;
  /** The words the search endpoint shows of the page, empty when it shows none. */
  readonly snippet: string;
}

/** Why a search found nothing to answer with, in words for the model. */
export class SearchFailed extends Error {
  override readonly name = "SearchFailed";
}

/**
 * The search endpoint WebSearch goes through for the OpenAI-compatible API (spec §5.4 Defaults),
 * one adapter per kind of search service. SearXNG is the one built.
 */
export interface SearchEndpointClient {
  /** The results for `query`, best first; throws `SearchFailed` when the search endpoint can't answer. */
  search(query: string, signal: AbortSignal): Promise<readonly SearchResult[]>;
}
