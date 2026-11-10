import { randomUUID } from "node:crypto";
import {
  mcpServerRefusalSchema,
  mcpServerSchema,
  type McpServer,
  type NewMcpServer,
} from "@the-office/contracts";
import { expect } from "vitest";
import { FAKE_STDIO_MCP_SERVER } from "../../../../platform/mcp/fake-mcp-servers.fixtures.js";

export const SECRET = "ghp_never-sent-back";

/** A name of the test's own, since every test file shares the database. */
export function aName(): string {
  return `github-${randomUUID().slice(0, 8)}`;
}

export function aServer(name: string): NewMcpServer {
  return {
    name,
    transport: "stdio",
    command: "npx",
    arguments: ["-y", "@modelcontextprotocol/server-github"],
    serverValues: [
      { name: "GITHUB_TOKEN", secret: true, required: true, officeWideValue: SECRET },
      { name: "GITHUB_HOST", secret: false, required: false, officeWideValue: "github.com" },
    ],
  };
}

/** The server as answered, checking the secret is nowhere in the answer. */
export async function serverOf(response: Response, status = 200): Promise<McpServer> {
  expect(response.status).toBe(status);
  const text = await response.text();
  expect(text).not.toContain(SECRET);
  return mcpServerSchema.parse(JSON.parse(text));
}

export async function reasonsOf(response: Response): Promise<string[]> {
  expect(response.status).toBe(422);
  return mcpServerRefusalSchema.parse(await response.json()).reasons;
}

/** A local server on the fake stdio MCP server, whose token is the secret. */
export function aFakeServer(
  name: string,
  flags: readonly string[] = [],
): Extract<NewMcpServer, { transport: "stdio" }> {
  return {
    name,
    transport: "stdio",
    command: process.execPath,
    arguments: [FAKE_STDIO_MCP_SERVER, ...flags],
    serverValues: [{ name: "FAKE_TOKEN", secret: true, required: true, officeWideValue: SECRET }],
  };
}

export const PROCESS_TIMEOUT = { timeout: 60_000 };
