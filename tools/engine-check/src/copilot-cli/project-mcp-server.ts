import type { MCPStdioServerConfig } from "@microsoft/copilot-sdk";
import { fileURLToPath } from "node:url";

export const PROJECT_SERVER = "project-tools";
export const PROJECT_SERVER_TOOL = "read_code_word";

/**
 * The session's config for `stdio-mcp-server.ts`, run by this Node with its types stripped; the
 * runtime names its tool `<server>-<tool>`.
 */
export function projectMcpServer(codeWord: string, callLog: string): MCPStdioServerConfig {
  return {
    type: "stdio",
    command: process.execPath,
    args: [fileURLToPath(new URL("stdio-mcp-server.ts", import.meta.url)), codeWord, callLog],
    tools: ["*"],
  };
}

export const PROJECT_SERVER_TOOL_NAME = `${PROJECT_SERVER}-${PROJECT_SERVER_TOOL}`;
