import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { EndpointRequests } from "../claude-code-p/local-endpoints.ts";
import type { OfficeTool } from "../claude-code-p/office-tool-server.ts";
import { OFFICE_TOOL_SERVER } from "../office-options.ts";

const MCP_PATH = "/mcp";

/**
 * A stand-in for the Office tools the service would serve a Codex session (spec §5.4 Defaults): an
 * MCP server over Streamable HTTP on `127.0.0.1`, behind a bearer token made for the session, which
 * the app-server reads from the variable its `bearer_token_env_var` names.
 */
export class OfficeToolHttpServer {
  readonly token = randomUUID();
  /** The MCP methods the app-server sent with the token, in order. */
  readonly methods: string[] = [];
  private readonly counts = { withToken: 0, refused: 0 };
  private readonly server: Server;
  private readonly transport: StreamableHTTPServerTransport;

  private constructor(server: Server, transport: StreamableHTTPServerTransport) {
    this.server = server;
    this.transport = transport;
  }

  static async start(tools: readonly OfficeTool[]): Promise<OfficeToolHttpServer> {
    const mcp = new McpServer({ name: OFFICE_TOOL_SERVER, version: "1.0.0" });
    for (const tool of tools) {
      mcp.registerTool(
        tool.name,
        { description: tool.description, inputSchema: tool.input },
        async (input: Record<string, unknown>) => ({
          content: [{ type: "text" as const, text: await tool.run(input) }],
        }),
      );
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
    await mcp.connect(transport);
    const server = createServer();
    const officeTools = new OfficeToolHttpServer(server, transport);
    server.on("request", (request, response) => {
      officeTools.handle(request, response).catch((error: unknown) => {
        if (!response.headersSent) {
          response.writeHead(500).end(String(error));
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return officeTools;
  }

  get url(): string {
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}${MCP_PATH}`;
  }

  /** Requests to the MCP endpoint, with the session's token or refused without it. */
  get requests(): EndpointRequests {
    return { ...this.counts };
  }

  async close(): Promise<void> {
    await this.transport.close();
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (new URL(request.url ?? "/", "http://127.0.0.1").pathname !== MCP_PATH) {
      response.writeHead(404).end();
      return;
    }
    if (request.headers.authorization !== `Bearer ${this.token}`) {
      this.counts.refused++;
      response.writeHead(401).end();
      return;
    }
    this.counts.withToken++;
    const body = request.method === "POST" ? await readJson(request) : undefined;
    for (const message of [body].flat()) {
      const method = (message as { method?: unknown } | undefined)?.method;
      if (typeof method === "string") this.methods.push(method);
    }
    await this.transport.handleRequest(request, response, body);
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
