import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import { FakeSearxngServer } from "../searxng/fake-searxng-server.fixtures.js";
import { SearxngClient } from "../searxng/searxng-client.js";
import { ReadFiles, type BuiltInTool, type ToolContext, type ToolOutput } from "./built-in-tool.js";
import { webFetchTool } from "./web-fetch-tool.js";
import { DEFAULT_WEB_PAGE_LIMITS, type WebPageLimits } from "./web-page.js";
import { webSearchTool } from "./web-search-tool.js";

const context: ToolContext = {
  folder: tmpdir(),
  environment: {},
  paths: currentOperatingSystem().paths,
  mayRead: () => true,
  readFiles: new ReadFiles(),
  callId: "call-1",
};

async function run(
  tool: BuiltInTool,
  input: unknown,
  signal = new AbortController().signal,
): Promise<ToolOutput> {
  const prepared = tool.prepare(input);
  if (!prepared.valid) throw new Error(prepared.problem);
  return prepared.run(context, signal);
}

function problemOf(tool: BuiltInTool, input: unknown): string | undefined {
  const prepared = tool.prepare(input);
  return prepared.valid ? undefined : prepared.problem;
}

type Route = (request: IncomingMessage, response: ServerResponse) => void;

const PAGE = `<!doctype html><html><head><title>Head title</title><style>body { color: red; }</style></head>
<body><h1>Office notes</h1><script>alert("hi")</script><p>Read <a href="https://example.com/">a link</a>.</p>
<ul><li>first</li><li>second</li></ul><noscript>Turn scripts on</noscript></body></html>`;

/** Pages for WebFetch on `127.0.0.1`, each path answered by its route. */
const ROUTES: Readonly<Record<string, Route>> = {
  "/page": (_request, response) =>
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGE),
  "/old": (_request, response) => response.writeHead(302, { location: "/new" }).end(),
  "/new": (_request, response) =>
    response.writeHead(200, { "content-type": "text/plain" }).end("moved here"),
  "/away": (_request, response) =>
    response
      .writeHead(301, "Moved Permanently", { location: `http://localhost:${port}/elsewhere` })
      .end(),
  "/long": (_request, response) =>
    response.writeHead(200, { "content-type": "text/plain" }).end("x".repeat(100)),
  "/large": (_request, response) =>
    response.writeHead(200, { "content-type": "text/plain" }).end("y".repeat(4096)),
  "/json": (_request, response) =>
    response.writeHead(200, { "content-type": "application/json" }).end('{"word":"tangerine"}'),
  "/image": (_request, response) =>
    response.writeHead(200, { "content-type": "image/png" }).end(Buffer.from([137, 80, 78, 71])),
  "/stall": () => undefined,
};

let server: Server;
let port: number;
let searxng: FakeSearxngServer;

beforeAll(async () => {
  server = createServer((request, response) => {
    const route = ROUTES[new URL(request.url ?? "/", "http://127.0.0.1").pathname];
    if (route === undefined) response.writeHead(404, "Not Found").end();
    else route(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  searxng = await FakeSearxngServer.start();
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await searxng.close();
});

function page(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

function fetchTool(limits: Partial<WebPageLimits> = {}): BuiltInTool {
  return webFetchTool({ ...DEFAULT_WEB_PAGE_LIMITS, ...limits });
}

describe("WebFetch", () => {
  it("turns an HTML page into Markdown, its title kept and its scripts and styles left out, under the prompt", async () => {
    const output = await run(fetchTool(), { url: page("/page"), prompt: "What are the notes?" });

    expect(output.isError).toBe(false);
    expect(output.text).toBe(
      [
        `Content of ${page("/page")}, for the prompt: What are the notes?`,
        "",
        "Head title",
        "",
        "# Office notes",
        "",
        "Read [a link](https://example.com/).",
        "",
        "-   first",
        "-   second",
      ].join("\n"),
    );
  });

  it("keeps text as it is and follows a redirect on the same host", async () => {
    expect((await run(fetchTool(), { url: page("/old"), prompt: "?" })).text).toContain(
      `Content of ${page("/new")}, for the prompt: ?\n\nmoved here`,
    );
    expect((await run(fetchTool(), { url: page("/json"), prompt: "?" })).text).toContain(
      '{"word":"tangerine"}',
    );
  });

  it("tells the model where a redirect to another host points, and doesn't follow it", async () => {
    const output = await run(fetchTool(), { url: page("/away"), prompt: "Read it" });

    expect(output).toEqual({
      isError: false,
      text: [
        "REDIRECT DETECTED: The URL redirects to a different host.",
        "",
        `Original URL: ${page("/away")}`,
        `Redirect URL: http://localhost:${port}/elsewhere`,
        "Status: 301 Moved Permanently",
        "",
        "To complete your request, fetch the redirected URL with WebFetch again:",
        `- url: "http://localhost:${port}/elsewhere"`,
        '- prompt: "Read it"',
      ].join("\n"),
    });
  });

  it("cuts a long page and says how much, and reads nothing of one past the size cap", async () => {
    expect(
      (await run(fetchTool({ maxCharacters: 40 }), { url: page("/long"), prompt: "?" })).text,
    ).toMatch(/\n\nx{40}\n\n\[60 more characters of the page were cut\.\]$/);
    expect(await run(fetchTool({ maxBytes: 1024 }), { url: page("/large"), prompt: "?" })).toEqual({
      isError: true,
      text: `${page("/large")} is larger than 1024 bytes; nothing of it was read.`,
    });
  });

  it("says why a page wasn't read: its status, its type, its time", async () => {
    expect(await run(fetchTool(), { url: page("/missing"), prompt: "?" })).toEqual({
      isError: true,
      text: `${page("/missing")} answered 404 Not Found.`,
    });
    expect((await run(fetchTool(), { url: page("/image"), prompt: "?" })).text).toBe(
      `WebFetch reads text and HTML pages; ${page("/image")} is image/png.`,
    );
    expect(await run(fetchTool({ timeoutMs: 200 }), { url: page("/stall"), prompt: "?" })).toEqual({
      isError: true,
      text: `${page("/stall")} could not be fetched: it didn't answer within 0.2 s`,
    });
  });

  it("stops on the turn's signal", async () => {
    const control = new AbortController();
    const fetching = run(fetchTool(), { url: page("/stall"), prompt: "?" }, control.signal);
    control.abort(new Error("interrupted"));

    await expect(fetching).rejects.toThrow("interrupted");
  });

  it("takes only http and https URLs, with a prompt", () => {
    expect(problemOf(fetchTool(), { url: "file:///etc/passwd", prompt: "?" })).toContain(
      "The URL must be http or https.",
    );
    expect(problemOf(fetchTool(), { url: page("/page") })).toContain("prompt");
  });
});

/** A trailing `/` on the base URL, as a user may type it. */
function searchTool(timeoutMs?: number): BuiltInTool {
  return webSearchTool(new SearxngClient({ baseUrl: `${searxng.baseUrl}/` }, timeoutMs));
}

describe("WebSearch through SearXNG", () => {
  const RESULTS = [
    {
      title: "Turndown",
      url: "https://github.com/mixmark-io/turndown",
      snippet: "HTML to Markdown",
    },
    { title: "Docs", url: "https://docs.searxng.org/dev/search_api.html", snippet: "" },
    { title: "Blog", url: "https://blog.example.com/post", snippet: "A post" },
  ];

  it("lists the results with their links, asking the model to cite them", async () => {
    searxng.results("html to markdown", RESULTS);

    const output = await run(searchTool(), { query: "html to markdown" });

    expect(output).toEqual({
      isError: false,
      text: [
        'Web search results for query: "html to markdown"',
        "",
        "1. [Turndown](https://github.com/mixmark-io/turndown)",
        "   HTML to Markdown",
        "2. [Docs](https://docs.searxng.org/dev/search_api.html)",
        "3. [Blog](https://blog.example.com/post)",
        "   A post",
        "",
        "REMINDER: You MUST include the sources above in your response to the user using markdown hyperlinks.",
      ].join("\n"),
    });
    const request = searxng.requests.at(-1);
    expect(request?.pathname).toBe("/searxng/search");
    expect(Object.fromEntries(request?.searchParams ?? [])).toEqual({
      q: "html to markdown",
      format: "json",
    });
  });

  it("keeps or drops results by their domain, subdomains included", async () => {
    searxng.results("domains", RESULTS);

    const allowed = await run(searchTool(), { query: "domains", allowed_domains: ["example.com"] });
    const blocked = await run(searchTool(), {
      query: "domains",
      blocked_domains: ["github.com", "searxng.org"],
    });

    expect(allowed.text).toContain("1. [Blog]");
    expect(allowed.text).not.toContain("Turndown");
    expect(blocked.text).toContain("1. [Blog]");
    expect(blocked.text).not.toContain("Docs");
    expect(
      problemOf(searchTool(), { query: "x y", allowed_domains: [], blocked_domains: [] }),
    ).toContain("Cannot specify both allowed_domains and blocked_domains");
  });

  it("says no result was found", async () => {
    expect((await run(searchTool(), { query: "nothing at all" })).text).toBe(
      'Web search results for query: "nothing at all"\n\nNo results.',
    );
  });

  it("says why the search endpoint didn't answer: JSON not on, or no answer in time", async () => {
    searxng.answersJson(false);
    try {
      expect(await run(searchTool(), { query: "refused" })).toEqual({
        isError: true,
        text: `The search endpoint ${new URL(searxng.baseUrl).origin} answered 403 Forbidden; SearXNG answers JSON only once its settings.yml lists json under search.formats.`,
      });
    } finally {
      searxng.answersJson(true);
    }
    searxng.silence("slow");
    expect((await run(searchTool(200), { query: "slow" })).text).toBe(
      `The search endpoint ${new URL(searxng.baseUrl).origin} could not be reached: it didn't answer within 0.2 s`,
    );
  });

  it("is refused by the engine with no search endpoint set", async () => {
    expect(await run(webSearchTool(undefined), { query: "anything" })).toEqual({
      isError: true,
      refused: true,
      text: "WebSearch has no search endpoint: none is set in Settings › Engines, so nothing was searched.",
    });
  });
});
