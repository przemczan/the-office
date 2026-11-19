/**
 * An MCP server over stdio, the kind a Project names in its MCP servers, that `copilot.mcp-servers`
 * gives a session: `node stdio-mcp-server.ts <code word> <call log>`. Its one tool answers the code
 * word, and appends a line to the call log on each call, so the check sees the server's own process
 * ran the call.
 */
import { appendFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PROJECT_SERVER, PROJECT_SERVER_TOOL } from "./project-mcp-server.ts";

const [codeWord = "", callLog = ""] = process.argv.slice(2);
const server = new McpServer({ name: PROJECT_SERVER, version: "1.0.0" });
server.registerTool(
  PROJECT_SERVER_TOOL,
  { description: "Answers the Project's code word." },
  async () => {
    appendFileSync(callLog, `${PROJECT_SERVER_TOOL}\n`);
    return { content: [{ type: "text" as const, text: codeWord }] };
  },
);
await server.connect(new StdioServerTransport());
