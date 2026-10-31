import { z } from "zod";
import { fetchFailure } from "../../../../platform/http/fetch-failure.js";
import type { SearchEndpoint } from "../../domain/engine-settings.js";
import {
  SearchFailed,
  type SearchEndpointClient,
  type SearchResult,
} from "../../ports/search-endpoint-client.js";

/** How long a search may take before it is given up, in milliseconds. */
export const SEARXNG_TIMEOUT_MS = 30_000;

/** The part of SearXNG's JSON answer the client reads; SearXNG sends much more. */
const searxngAnswerSchema = z.object({
  results: z.array(
    z.object({
      url: z.string(),
      title: z.string().optional(),
      content: z.string().nullish(),
    }),
  ),
});

/**
 * A SearXNG instance's JSON API (`/search?format=json`), which needs no key. A stock instance
 * answers 403 until its `settings.yml` lists `json` under `search.formats`.
 */
export class SearxngClient implements SearchEndpointClient {
  constructor(
    private readonly endpoint: SearchEndpoint,
    private readonly timeoutMs = SEARXNG_TIMEOUT_MS,
  ) {}

  async search(query: string, signal: AbortSignal): Promise<readonly SearchResult[]> {
    const url = searchUrl(this.endpoint.baseUrl, query);
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]),
      });
    } catch (error) {
      signal.throwIfAborted();
      throw new SearchFailed(
        `The search endpoint ${url.origin} could not be reached: ${fetchFailure(error, this.timeoutMs)}`,
      );
    }
    if (!response.ok) throw new SearchFailed(refusedWords(response, url));
    const answer: unknown = await response.json().catch(() => undefined);
    signal.throwIfAborted();
    const parsed = searxngAnswerSchema.safeParse(answer);
    if (!parsed.success) {
      throw new SearchFailed(
        `The search endpoint ${url.origin} didn't answer with SearXNG's JSON results.`,
      );
    }
    return parsed.data.results.map((result) => ({
      title: result.title ?? result.url,
      url: result.url,
      snippet: result.content ?? "",
    }));
  }
}

/** `<base URL>/search`, a path in the base URL kept, as a SearXNG under a path is reached. */
export function searchUrl(baseUrl: string, query: string): URL {
  const url = new URL("search", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  return url;
}

function refusedWords(response: Response, url: URL): string {
  const answered = `The search endpoint ${url.origin} answered ${response.status} ${response.statusText}`;
  return response.status === 403
    ? `${answered}; SearXNG answers JSON only once its settings.yml lists json under search.formats.`
    : `${answered}.`;
}
