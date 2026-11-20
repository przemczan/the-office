/**
 * The model the `gemini.*` checks run on, named explicitly: the cheapest Flash-Lite the Gemini API
 * serves a new API key (it refuses `gemini-2.5-flash-lite` to new users). The CLI's `flash-lite` alias
 * resolves by the account's access, so it isn't used.
 */
export const GEMINI_CHECK_MODEL = "gemini-3.5-flash-lite";

/**
 * The two ways to drive the pinned CLI: `acp`, one long-lived `gemini --acp` per session speaking the
 * Agent Client Protocol on stdio; `headless`, one `gemini --output-format stream-json` process per
 * turn, a later turn resuming the session by its id.
 */
export type GeminiTransport = "acp" | "headless";

export const GEMINI_TRANSPORTS: readonly GeminiTransport[] = ["acp", "headless"];

/** The MCP server name the Office tools are served under; the model sees `mcp_office_<tool>`. */
export const OFFICE_SERVER = "office";

/** The name the model calls an MCP tool by: `mcp_<server>_<tool>`. */
export function mcpToolName(server: string, tool: string): string {
  return `mcp_${server}_${tool}`;
}

/** The built-in tools a session gets (`tools.core`), the same on both platforms. */
export const GEMINI_CORE_TOOLS = [
  "activate_skill",
  "glob",
  "grep_search",
  "list_directory",
  "read_file",
  "replace",
  "run_shell_command",
  "write_file",
] as const;

/** The variable the run takes the file holding the Gemini API key from. */
export const GEMINI_API_KEY_FILE_VARIABLE = "ENGINE_CHECK_GEMINI_API_KEY_FILE";

/** The variable a session's relays read the Office channel's address from. */
export const OFFICE_CHANNEL_VARIABLE = "OFFICE_CHANNEL";

/** The variable a session's relays read the per-session token from, never written to a file. */
export const OFFICE_SESSION_TOKEN_VARIABLE = "OFFICE_SESSION_TOKEN";
