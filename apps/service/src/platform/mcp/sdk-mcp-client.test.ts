import { afterEach, describe, expect, it } from "vitest";
import {
  FAKE_HTTP_MCP_TOOLS,
  FAKE_STDIO_MCP_TOOLS,
  fakeStdioMcpServer,
  startFakeHttpMcpServer,
  type FakeHttpMcpServer,
} from "./fake-mcp-servers.fixtures.js";
import { type McpConnection } from "./mcp-client.js";
import { SdkMcpClient } from "./sdk-mcp-client.js";

const client = new SdkMcpClient();
const options = { timeoutMs: 15_000 };
const PROCESS_TIMEOUT = { timeout: 30_000 };

const textOf = async (connection: McpConnection, tool: string, input = {}): Promise<string> => {
  const { content } = await connection.callTool(tool, input, options);
  return content.map((block) => (block.type === "text" ? block.text : "")).join("");
};

describe("SdkMcpClient", () => {
  describe("a local server (stdio)", () => {
    it("lists its tools and calls one", PROCESS_TIMEOUT, async () => {
      const connection = await client.connect(fakeStdioMcpServer(), options);
      try {
        const tools = await connection.listTools(options);

        expect(tools.map(({ name }) => name)).toEqual(FAKE_STDIO_MCP_TOOLS);
        expect(tools[0]).toMatchObject({
          description: "Answers with the text it is given.",
          inputSchema: { type: "object", properties: { text: { type: "string" } } },
        });
        expect(await textOf(connection, "echo", { text: "hello" })).toBe("hello");
      } finally {
        await connection.close();
      }
    });
  });

  describe("a remote server (Streamable HTTP)", () => {
    let server: FakeHttpMcpServer | undefined;

    afterEach(async () => {
      await server?.close();
      server = undefined;
    });

    it("lists its tools and calls one with the headers", async () => {
      server = await startFakeHttpMcpServer();
      const connection = await client.connect(
        { transport: "streamable-http", url: server.url, headers: { "X-Api-Key": "abc" } },
        options,
      );
      try {
        const tools = await connection.listTools(options);

        expect(tools.map(({ name }) => name)).toEqual(FAKE_HTTP_MCP_TOOLS);
        expect(await textOf(connection, "echo", { text: "hello" })).toBe("hello");
        expect(await textOf(connection, "header", { name: "x-api-key" })).toBe("abc");
      } finally {
        await connection.close();
      }
    });
  });
});
