import { describe, expect, it } from "vitest";
import { McpServerRefused } from "./mcp-server-refused.js";
import { pastedMcpServer } from "./pasted-config.js";

function reasonsOf(config: string): readonly string[] {
  try {
    pastedMcpServer(config);
  } catch (error) {
    if (error instanceof McpServerRefused) return error.reasons;
    throw error;
  }
  throw new Error("Expected a refusal.");
}

describe("pastedMcpServer", () => {
  it("reads a local server from Claude Code's mcpServers, its secret-looking values secret", () => {
    const config = JSON.stringify({
      mcpServers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_x", GITHUB_HOST: "github.com" },
        },
      },
    });

    expect(pastedMcpServer(config)).toEqual({
      name: "github",
      connection: {
        transport: "stdio",
        command: "npx",
        arguments: ["-y", "@modelcontextprotocol/server-github"],
      },
      serverValues: [
        {
          name: "GITHUB_PERSONAL_ACCESS_TOKEN",
          secret: true,
          required: true,
          officeWideValue: "ghp_x",
        },
        { name: "GITHUB_HOST", secret: false, required: true, officeWideValue: "github.com" },
      ],
    });
  });

  it("reads a remote server by its name alone, a reference to a variable not a value", () => {
    const config = JSON.stringify({
      linear: {
        type: "http",
        url: "https://mcp.linear.app/mcp",
        headers: { Authorization: "${LINEAR_TOKEN}", "X-Region": "${REGION:-eu}" },
      },
    });

    expect(pastedMcpServer(config)).toEqual({
      name: "linear",
      connection: { transport: "streamable-http", url: "https://mcp.linear.app/mcp" },
      serverValues: [
        { name: "Authorization", secret: true, required: true },
        { name: "X-Region", secret: false, required: true, officeWideValue: "eu" },
      ],
    });
  });

  it("reads an entry alone, without a name for the user to give", () => {
    expect(pastedMcpServer('{"command": "uvx", "args": ["mcp-server-time"]}')).toEqual({
      name: "",
      connection: { transport: "stdio", command: "uvx", arguments: ["mcp-server-time"] },
      serverValues: [],
    });
  });

  it.each([
    ["not json", "The pasted config isn't valid JSON."],
    ["[1]", "The pasted config isn't a JSON object."],
    ['{"mcpServers": {}}', "The pasted config holds no MCP server."],
    [
      '{"a": {"command": "x"}, "b": {"command": "y"}}',
      "The pasted config holds 2 MCP servers; paste one at a time.",
    ],
    [
      '{"type": "sse", "url": "https://example.com/sse"}',
      "The Office doesn't run servers on the legacy SSE transport; use the server's Streamable HTTP URL.",
    ],
    [
      '{"type": "ws", "url": "wss://x"}',
      'The Office doesn\'t run MCP servers of type "ws": only stdio and http.',
    ],
    ['{"type": "stdio"}', "The entry needs its command as text."],
    ['{"command": "x", "args": "-y"}', "The entry's args isn't a list of texts."],
    ['{"command": "x", "env": {"PORT": 80}}', "The entry's env.PORT isn't text."],
  ])("refuses %s", (config, reason) => {
    expect(reasonsOf(config)).toEqual([reason]);
  });
});
