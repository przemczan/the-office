import type { McpServerLaunch } from "../../../platform/mcp/mcp-client.js";
import type { McpServer } from "../domain/mcp-server.js";

/** Each Server value's Office-wide value, by its name; a value not set is left out. */
export function officeWideValues(server: McpServer): Record<string, string> {
  return Object.fromEntries(
    server.serverValues.flatMap(({ name, officeWideValue }) =>
      officeWideValue === undefined ? [] : [[name, officeWideValue]],
    ),
  );
}

/**
 * How the MCP client reaches the server with these values: its environment variables when it
 * runs locally, started in `workingFolder`, its headers when remote.
 */
export function launchOf(
  server: McpServer,
  values: Readonly<Record<string, string>>,
  workingFolder: string,
): McpServerLaunch {
  const { connection } = server;
  if (connection.transport === "streamable-http") {
    return { transport: "streamable-http", url: connection.url, headers: { ...values } };
  }
  return {
    transport: "stdio",
    command: connection.command,
    arguments: connection.arguments,
    environmentVariables: { ...values },
    workingFolder,
  };
}
