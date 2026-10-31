import type { McpServer } from "./mcp-server.js";

/** A local server that is on, with a required secret and an optional plain value. */
export function anMcpServer(changes: Partial<McpServer> = {}): McpServer {
  return {
    name: "github",
    connection: { transport: "stdio", command: "npx", arguments: ["-y", "server-github"] },
    serverValues: [
      { name: "GITHUB_TOKEN", secret: true, required: true, officeWideValue: "office-token" },
      { name: "GITHUB_HOST", secret: false, required: false },
    ],
    state: "on",
    tools: [
      {
        name: "list_issues",
        description: "Lists the issues.",
        inputSchema: { type: "object", properties: { repository: { type: "string" } } },
      },
    ],
    addedAt: new Date("2026-10-31T09:00:00Z"),
    ...changes,
  };
}
