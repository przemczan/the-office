import type { SessionMcpServerTool } from "../../ports/session-options.js";
import type { McpServerConnections } from "../mcp-servers/mcp-server-connections.js";
import { mcpToolName } from "../office-rules/office-tool-names.js";
import type { BuiltInTool } from "./built-in-tool.js";

/**
 * A tool of one of the session's MCP servers as the model calls it, `mcp__<server>__<tool>`, with
 * the description and input schema recorded at the server's review. Its input is checked by the
 * server; the loop asks only for an object. It is not judged again as it runs: the loop's judging
 * already waited on any approval, which a second judging would ask for twice.
 */
export function mcpBuiltInTool(
  server: string,
  tool: SessionMcpServerTool,
  connections: McpServerConnections,
): BuiltInTool {
  const name = mcpToolName(server, tool.name);
  const { $schema: _schema, ...parameters } = tool.inputSchema;
  return {
    name,
    officeTool: false,
    definition: {
      type: "function",
      function: { name, description: tool.description, parameters },
    },
    prepare(input) {
      if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return { valid: false, problem: "An MCP tool takes its input as a JSON object." };
      }
      return {
        valid: true,
        input,
        run: (_context, signal) => connections.call(server, tool.name, input, signal),
      };
    },
  };
}
