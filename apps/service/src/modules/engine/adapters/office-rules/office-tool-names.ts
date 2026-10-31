/** The MCP server that holds a session's Office tools, in-process or on `localhost`. */
export const OFFICE_TOOL_SERVER = "office";

/** What the engine calls an Office tool by. */
export const OFFICE_TOOL_PREFIX = `mcp__${OFFICE_TOOL_SERVER}__`;

/**
 * What the engine calls a tool of one of the session's MCP servers: `mcp__<server>__<tool>`. A
 * server's name has single hyphens only, so its first `__` ends it.
 */
const MCP_TOOL_NAME = /^mcp__([a-z0-9-]+)__(.+)$/;

/** What the engine calls a tool of one of the session's MCP servers. */
export function mcpToolName(server: string, tool: string): string {
  return `mcp__${server}__${tool}`;
}

/** The server and the tool an engine's tool name names, or undefined for a tool of no MCP server. */
export function mcpToolOf(
  engineName: string,
): { readonly server: string; readonly tool: string } | undefined {
  const match = MCP_TOOL_NAME.exec(engineName);
  return match?.[1] !== undefined && match[2] !== undefined
    ? { server: match[1], tool: match[2] }
    : undefined;
}

/** A tool's name as the port has it: an Office tool by its own name, any other as the engine names it. */
export function portToolName(engineName: string): string {
  return engineName.startsWith(OFFICE_TOOL_PREFIX)
    ? engineName.slice(OFFICE_TOOL_PREFIX.length)
    : engineName;
}
