import { createSdkMcpServer, type tool } from "@anthropic-ai/claude-agent-sdk";
import { OFFICE_TOOL_SERVER } from "../../office-options.ts";
import type { SessionSpec } from "../../probe-session.ts";

/** The tool definitions `createSdkMcpServer()` takes, each with its own input schema. */
type OfficeTools = NonNullable<Parameters<typeof createSdkMcpServer>[0]["tools"]>;

/** What a tool handler returns; the SDK takes the type from the MCP SDK without exporting it. */
type ToolResult = Awaited<ReturnType<Parameters<typeof tool>[3]>>;

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

/** What the SDK sets on a tool made with `alwaysLoad`, so it waits behind no tool search. */
const ALWAYS_LOAD = { "anthropic/alwaysLoad": true };

/**
 * Session options that add the Office tools. `tools` are always loaded, so no ToolSearch round comes
 * before a first call; `deferred` ones carry no mark, so the engine's tool search loads them on
 * demand, as the service serves the areas a session isn't started with. They are allowed by a rule
 * unless `allowed` is false, as a Role's profile grants them.
 */
export function withOfficeTools(
  tools: OfficeTools,
  allowed = true,
  deferred: OfficeTools = [],
): Pick<SessionSpec, "options" | "settings"> {
  return {
    options: {
      mcpServers: {
        [OFFICE_TOOL_SERVER]: createSdkMcpServer({
          name: OFFICE_TOOL_SERVER,
          tools: [...tools.map((loaded) => ({ ...loaded, _meta: ALWAYS_LOAD })), ...deferred],
        }),
      },
    },
    settings: allowed ? { permissions: { allow: [`mcp__${OFFICE_TOOL_SERVER}`] } } : {},
  };
}
