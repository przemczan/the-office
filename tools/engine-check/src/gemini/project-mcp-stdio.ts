/**
 * A Project's own MCP server over stdio, as The Office gives a session one of the Office's MCP
 * servers: its secret value comes in its environment only. Its one tool answers whether the value
 * arrived, and the server notes its pid, command line and each call in the file its one argument
 * names, so `gemini.mcp-servers` sees the value stayed off the command line and the process ended.
 */
import { appendFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  PROJECT_SECRET_VARIABLE,
  PROJECT_SERVER,
  PROJECT_SERVER_TOOL,
} from "./project-mcp-server.ts";

const [processLog = ""] = process.argv.slice(2);
appendFileSync(processLog, `${JSON.stringify({ pid: process.pid, argv: process.argv })}\n`);
const server = new McpServer({ name: PROJECT_SERVER, version: "1.0.0" });
server.registerTool(
  PROJECT_SERVER_TOOL,
  { description: "Answers whether the Project's service secret is set." },
  async () => {
    const secretSet = (process.env[PROJECT_SECRET_VARIABLE] ?? "") !== "";
    appendFileSync(processLog, `${JSON.stringify({ call: PROJECT_SERVER_TOOL, secretSet })}\n`);
    return { content: [{ type: "text" as const, text: secretSet ? "SET" : "MISSING" }] };
  },
);
await server.connect(new StdioServerTransport());
