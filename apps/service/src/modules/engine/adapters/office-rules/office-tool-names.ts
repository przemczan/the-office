/** The MCP server that holds a session's Office tools, in-process or on `localhost`. */
export const OFFICE_TOOL_SERVER = "office";

/** What the engine calls an Office tool by. */
export const OFFICE_TOOL_PREFIX = `mcp__${OFFICE_TOOL_SERVER}__`;
