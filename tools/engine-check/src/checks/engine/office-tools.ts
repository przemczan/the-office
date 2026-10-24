import { createSdkMcpServer, type tool } from "@anthropic-ai/claude-agent-sdk";
import type { SessionSpec } from "../../probe-session.ts";

/** The in-process MCP server that holds the Office tools (spec §5.4). */
export const OFFICE_TOOL_SERVER = "office";

/** The name the model calls an Office tool by. */
export function officeToolName(tool: string): string {
  return `mcp__${OFFICE_TOOL_SERVER}__${tool}`;
}

/** The tool definitions `createSdkMcpServer()` takes, each with its own input schema. */
type OfficeTools = NonNullable<Parameters<typeof createSdkMcpServer>[0]["tools"]>;

/** What a tool handler returns; the SDK takes the type from the MCP SDK without exporting it. */
type ToolResult = Awaited<ReturnType<Parameters<typeof tool>[3]>>;

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

/**
 * Session options that add the Office tools. They are always loaded, so no ToolSearch round comes
 * before a first call, and allowed by a rule unless `allowed` is false, as a Role's profile grants them.
 */
export function withOfficeTools(tools: OfficeTools, allowed = true): Pick<SessionSpec, "options" | "settings"> {
  return {
    options: { mcpServers: { [OFFICE_TOOL_SERVER]: createSdkMcpServer({ name: OFFICE_TOOL_SERVER, tools, alwaysLoad: true }) } },
    settings: allowed ? { permissions: { allow: [`mcp__${OFFICE_TOOL_SERVER}`] } } : {},
  };
}
