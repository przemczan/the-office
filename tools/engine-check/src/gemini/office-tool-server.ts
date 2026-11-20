/**
 * The Office tools of a Gemini session as an MCP server over stdio, which the CLI starts as a child:
 * it lists the tools and relays each call to the session's Office channel, never over a `localhost`
 * HTTP endpoint (the `-p` lesson of spec §5.4). It also notes its pid and command line in the file
 * named by its one argument, so a check can see the process ended and held no secret on its command
 * line.
 */
import { appendFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { Json } from "../json.ts";
import { askChannel } from "./office-channel.ts";
import { OFFICE_CHANNEL_VARIABLE, OFFICE_SESSION_TOKEN_VARIABLE } from "./options.ts";

const [processLog] = process.argv.slice(2);
if (processLog !== undefined) {
  appendFileSync(processLog, `${JSON.stringify({ pid: process.pid, argv: process.argv })}\n`);
}
const address = process.env[OFFICE_CHANNEL_VARIABLE] ?? "";
const token = process.env[OFFICE_SESSION_TOKEN_VARIABLE] ?? "";

// The tools come with JSON schemas from the channel, so they are served on the protocol server itself.
const mcp = new McpServer({ name: "office", version: "1.0.0" }, { capabilities: { tools: {} } });
mcp.server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: (await askChannel(address, { token, kind: "list-tools" })) as unknown as Tool[],
}));
mcp.server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const answer = (await askChannel(address, {
    token,
    kind: "call-tool",
    name: request.params.name,
    input: (request.params.arguments ?? {}) as Json,
  })) as { text: string; isError: boolean };
  return { content: [{ type: "text" as const, text: answer.text }], isError: answer.isError };
});
await mcp.connect(new StdioServerTransport());
