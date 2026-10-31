import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { McpServerLaunch } from "./mcp-client.js";

/** The fake local server's script, which Node runs as it is. */
export const FAKE_STDIO_MCP_SERVER = fileURLToPath(
  new URL("./fake-stdio-mcp-server.fixtures.ts", import.meta.url),
);

/** The fake local server's tools, as it lists them. */
export const FAKE_STDIO_MCP_TOOLS = ["echo", "environment-variable", "started-process"];

/** Starts the fake local server with its flags (`--silent`, `--fail`): see its script. */
export function fakeStdioMcpServer(
  flags: readonly string[] = [],
  environmentVariables: Readonly<Record<string, string>> = {},
): Extract<McpServerLaunch, { transport: "stdio" }> {
  return {
    transport: "stdio",
    command: process.execPath,
    arguments: [FAKE_STDIO_MCP_SERVER, ...flags],
    environmentVariables,
    workingFolder: tmpdir(),
  };
}

/** The fake remote server's tools, as it lists them. */
export const FAKE_HTTP_MCP_TOOLS = ["echo", "header"];

export interface FakeHttpMcpServer {
  readonly url: string;
  close(): Promise<void>;
}

/**
 * A remote MCP server on a local port, answering over Streamable HTTP without sessions; or, when
 * `answers` is false, one that takes each request and never answers it.
 */
export async function startFakeHttpMcpServer({ answers = true } = {}): Promise<FakeHttpMcpServer> {
  const httpServer = createServer((request, response) => {
    if (!answers) return;
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const mcpServer = fakeHttpTools(request);
    response.on("close", () => void mcpServer.close());
    void mcpServer
      .connect(transport)
      .then(() => transport.handleRequest(request, response))
      .catch(() => response.destroy());
  });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const { port } = httpServer.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/mcp`, close: () => closeServer(httpServer) };
}

function fakeHttpTools(request: IncomingMessage): McpServer {
  const server = new McpServer({ name: "fake-http", version: "1.0.0" });
  server.registerTool(
    "echo",
    { description: "Answers with the text it is given.", inputSchema: { text: z.string() } },
    ({ text }) => ({ content: [{ type: "text", text }] }),
  );
  server.registerTool(
    "header",
    { description: "Answers with a request header's value.", inputSchema: { name: z.string() } },
    ({ name }) => ({ content: [{ type: "text", text: String(request.headers[name] ?? "") }] }),
  );
  return server;
}

function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(() => resolve()));
}
