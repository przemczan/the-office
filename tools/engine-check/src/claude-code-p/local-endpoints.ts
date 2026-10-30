import type { HookInput, HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { ZodRawShape } from "zod";
import { OFFICE_TOOL_SERVER } from "../office-options.ts";

const HOOK_PATH = "/hook";
const MCP_PATH = "/mcp";

/** An Office tool as the stand-in serves it: its handler answers with text. */
export interface EndpointTool {
  readonly name: string;
  readonly description: string;
  readonly input: ZodRawShape;
  run(input: Record<string, unknown>): Promise<string>;
}

export type HookAnswer = (input: HookInput) => Promise<HookJSONOutput>;

export interface EndpointRequests {
  /** Requests that carried the session's token. */
  readonly withToken: number;
  /** Requests refused for a missing or wrong token. */
  readonly refused: number;
}

/**
 * A stand-in for what the service serves the `-p` fallback on `localhost` (spec §5.4 Defaults): an
 * MCP endpoint with the session's Office tools and the hook endpoint the Office rules answer, both
 * behind a token made for the session.
 */
export class LocalEndpoints {
  readonly token = randomUUID();
  private readonly counts = {
    hook: { withToken: 0, refused: 0 },
    mcp: { withToken: 0, refused: 0 },
  };
  private answerHook: HookAnswer | undefined;
  private readonly server: Server;
  private readonly tools: readonly EndpointTool[];

  private constructor(server: Server, tools: readonly EndpointTool[]) {
    this.server = server;
    this.tools = tools;
  }

  static async start(tools: readonly EndpointTool[]): Promise<LocalEndpoints> {
    const server = createServer();
    const endpoints = new LocalEndpoints(server, tools);
    server.on("request", (request, response) => {
      endpoints.handle(request, response).catch((error: unknown) => {
        if (!response.headersSent) {
          response.writeHead(500).end(String(error));
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return endpoints;
  }

  /** Who answers the hook calls; until set, a call gets a failure, which the engine is told to count as a refusal. */
  answerHooksWith(answer: HookAnswer): void {
    this.answerHook = answer;
  }

  get hookUrl(): string {
    return `${this.origin}${HOOK_PATH}`;
  }

  get mcpUrl(): string {
    return `${this.origin}${MCP_PATH}`;
  }

  get hookRequests(): EndpointRequests {
    return { ...this.counts.hook };
  }

  get mcpRequests(): EndpointRequests {
    return { ...this.counts.mcp };
  }

  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private get origin(): string {
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = new URL(request.url ?? "/", this.origin).pathname;
    const counts =
      path === HOOK_PATH ? this.counts.hook : path === MCP_PATH ? this.counts.mcp : undefined;
    if (counts === undefined) {
      response.writeHead(404).end();
      return;
    }
    if (request.headers.authorization !== `Bearer ${this.token}`) {
      counts.refused++;
      response.writeHead(401).end();
      return;
    }
    counts.withToken++;
    const body = request.method === "POST" ? await readJson(request) : undefined;
    if (path === HOOK_PATH) {
      if (this.answerHook === undefined) {
        response.writeHead(503).end();
        return;
      }
      const output = await this.answerHook(body as HookInput);
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(output));
      return;
    }
    await this.serveMcp(request, response, body);
  }

  /** Stateless: a server and transport per request, as the MCP SDK's own stateless example does. */
  private async serveMcp(
    request: IncomingMessage,
    response: ServerResponse,
    body: unknown,
  ): Promise<void> {
    const mcp = new McpServer({ name: OFFICE_TOOL_SERVER, version: "1.0.0" });
    for (const tool of this.tools) {
      mcp.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.input },
        async (input: Record<string, unknown>) => ({
          content: [{ type: "text" as const, text: await tool.run(input) }],
        }),
      );
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    response.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    await mcp.connect(transport);
    await transport.handleRequest(request, response, body);
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text === "" ? undefined : JSON.parse(text);
}
