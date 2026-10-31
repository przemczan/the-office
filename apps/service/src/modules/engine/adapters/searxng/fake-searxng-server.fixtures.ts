import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { SearchResult } from "../../ports/search-endpoint-client.js";

/** What the fake answers a query with. */
type FakeAnswer =
  | { readonly kind: "results"; readonly results: readonly SearchResult[] }
  | { readonly kind: "silence" };

/**
 * A SearXNG for tests on `127.0.0.1`: it answers `/search?format=json` by the query, each query's
 * results set in advance (none when not set), and records each request's URL. With `json: false`
 * it answers 403, as a stock SearXNG whose settings don't list the JSON format does.
 */
export class FakeSearxngServer {
  private readonly answers = new Map<string, FakeAnswer>();
  private readonly recorded: URL[] = [];
  private json = true;

  private constructor(
    private readonly server: Server,
    /** The base URL as a user would type it, under a path as SearXNG may be served. */
    readonly baseUrl: string,
  ) {}

  static async start(): Promise<FakeSearxngServer> {
    let fake: FakeSearxngServer | undefined;
    const server = createServer((request, response) => fake?.answer(request, response));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    fake = new FakeSearxngServer(server, `http://127.0.0.1:${port}/searxng`);
    return fake;
  }

  /** What the query `query` finds. */
  results(query: string, results: readonly SearchResult[]): void {
    this.answers.set(query, { kind: "results", results });
  }

  /** Leaves the query `query` unanswered, as a search endpoint that hangs. */
  silence(query: string): void {
    this.answers.set(query, { kind: "silence" });
  }

  /** Whether it answers the JSON format, as SearXNG's `search.formats` setting says. */
  answersJson(json: boolean): void {
    this.json = json;
  }

  get requests(): readonly URL[] {
    return this.recorded;
  }

  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private answer(request: IncomingMessage, response: ServerResponse): void {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    this.recorded.push(url);
    if (url.pathname !== "/searxng/search") {
      response.writeHead(404).end();
      return;
    }
    if (url.searchParams.get("format") !== "json" || !this.json) {
      response.writeHead(403, "Forbidden").end();
      return;
    }
    const query = url.searchParams.get("q") ?? "";
    const answer = this.answers.get(query) ?? { kind: "results", results: [] };
    if (answer.kind === "silence") return;
    response.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        query,
        number_of_results: answer.results.length,
        results: answer.results.map(({ title, url: resultUrl, snippet }) => ({
          title,
          url: resultUrl,
          content: snippet,
          engine: "fake",
        })),
        answers: [],
        suggestions: [],
      }),
    );
  }
}
