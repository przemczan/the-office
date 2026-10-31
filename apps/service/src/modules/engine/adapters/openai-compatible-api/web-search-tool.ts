import { z } from "zod";
import {
  SearchFailed,
  type SearchEndpointClient,
  type SearchResult,
} from "../../ports/search-endpoint-client.js";
import {
  builtInTool,
  engineRefusal,
  failure,
  success,
  type BuiltInTool,
  type ToolOutput,
} from "./built-in-tool.js";

/** How many results the model reads, about as many as Claude Code's search gives. */
const MAX_RESULTS = 10;

const NO_SEARCH_ENDPOINT =
  "WebSearch has no search endpoint: none is set in Settings › Engines, so nothing was searched.";

const webSearchInput = z
  .object({
    query: z.string().min(2).describe("The search query to use"),
    allowed_domains: z
      .array(z.string())
      .optional()
      .describe("Only include search results from these domains"),
    blocked_domains: z
      .array(z.string())
      .optional()
      .describe("Never include search results from these domains"),
  })
  .refine(
    ({ allowed_domains, blocked_domains }) =>
      allowed_domains === undefined || blocked_domains === undefined,
    "Cannot specify both allowed_domains and blocked_domains in the same request.",
  );

type WebSearchInput = z.infer<typeof webSearchInput>;

/**
 * Claude Code's WebSearch, under its name and input, through the session's search endpoint. With
 * none set it is still offered, so the tool list stays the same, and each call is refused in words
 * that say so, once the Office rules have judged it.
 */
export function webSearchTool(searchEndpoint: SearchEndpointClient | undefined): BuiltInTool {
  return builtInTool({
    name: "WebSearch",
    description: [
      "Searches the web and returns the results' titles, links and snippets, to inform your answer with up-to-date information.",
      "- `allowed_domains` or `blocked_domains` (not both) keep or drop results by their domain.",
      "- Cite the sources you use as Markdown links.",
    ].join("\n"),
    input: webSearchInput,
    run: async (input, _context, signal) => {
      if (searchEndpoint === undefined) return engineRefusal(NO_SEARCH_ENDPOINT);
      try {
        return searchOutput(
          input.query,
          kept(await searchEndpoint.search(input.query, signal), input),
        );
      } catch (error) {
        if (error instanceof SearchFailed) return failure(error.message);
        throw error;
      }
    },
  });
}

/** The results the domain filters keep, as many as the model reads. */
function kept(results: readonly SearchResult[], input: WebSearchInput): readonly SearchResult[] {
  const { allowed_domains: allowed, blocked_domains: blocked } = input;
  return results
    .filter((result) => {
      const host = hostOf(result.url);
      if (host === undefined) return false;
      if (allowed !== undefined) return allowed.some((domain) => isWithin(host, domain));
      return !(blocked ?? []).some((domain) => isWithin(host, domain));
    })
    .slice(0, MAX_RESULTS);
}

function searchOutput(query: string, results: readonly SearchResult[]): ToolOutput {
  const heading = `Web search results for query: "${query}"`;
  if (results.length === 0) return success(`${heading}\n\nNo results.`);
  const listed = results.map(({ title, url, snippet }, index) =>
    [`${index + 1}. [${title}](${url})`, ...(snippet === "" ? [] : [`   ${snippet}`])].join("\n"),
  );
  return success(
    [
      heading,
      "",
      ...listed,
      "",
      "REMINDER: You MUST include the sources above in your response to the user using markdown hyperlinks.",
    ].join("\n"),
  );
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** Whether `host` is `domain` or one of its subdomains. */
function isWithin(host: string, domain: string): boolean {
  const bare = domain
    .trim()
    .toLowerCase()
    .replace(/^\*?\./, "");
  return host === bare || host.endsWith(`.${bare}`);
}
