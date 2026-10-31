import type { McpHttpServerConfig, McpStdioServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { SessionMcpServer } from "../../ports/session-options.js";

/** A session's MCP server as the binary takes it in `--mcp-config`. */
export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

/**
 * The session's MCP servers as the binary's MCP config names them (spec §5.4). The binary starts a
 * local server in the session's folder, with its own environment and the server's variables over
 * it, finding its command as a shell would (`npx` is `npx.cmd` on Windows). Each of `hidden`, a
 * variable the binary runs with that is no server's business, is set blank over it: the binary
 * passes no way to leave one out. The tools stay deferred behind tool search, as the engine
 * defaults: a server may list many, and its tools are fixed from the session's start either way.
 */
export function mcpServerConfigs(
  servers: readonly SessionMcpServer[],
  hidden: readonly string[] = [],
): Record<string, McpServerConfig> {
  return Object.fromEntries(
    servers.map(({ name, launch }) => [
      name,
      launch.transport === "stdio"
        ? {
            type: "stdio",
            command: launch.command,
            args: [...launch.arguments],
            env: {
              ...launch.environmentVariables,
              ...Object.fromEntries(hidden.map((variable) => [variable, ""])),
            },
          }
        : { type: "http", url: launch.url, headers: { ...launch.headers } },
    ]),
  );
}
