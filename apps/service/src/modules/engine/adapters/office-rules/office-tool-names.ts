/** The MCP server that holds a session's Office tools, in-process or on `localhost`. */
export const OFFICE_TOOL_SERVER = "office";

/** What the engine calls an Office tool by. */
export const OFFICE_TOOL_PREFIX = `mcp__${OFFICE_TOOL_SERVER}__`;

/** A tool's name as the port has it: an Office tool by its own name, any other as the engine names it. */
export function portToolName(engineName: string): string {
  return engineName.startsWith(OFFICE_TOOL_PREFIX)
    ? engineName.slice(OFFICE_TOOL_PREFIX.length)
    : engineName;
}
