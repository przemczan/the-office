import { join } from "node:path";

/**
 * The model the `gemini.*` checks run on, named explicitly: the cheapest Flash-Lite the Gemini API
 * serves a new API key (it refuses `gemini-2.5-flash-lite` to new users). The CLI's `flash-lite` alias
 * resolves by the account's access, so it isn't used.
 */
export const GEMINI_CHECK_MODEL = "gemini-3.5-flash-lite";

/** The id of the engine whose folder the check's sessions run in, as a Gemini CLI engine's in The Office. */
export const GEMINI_CHECK_ENGINE_ID = "gemini-cli";

/** The MCP server the Office tools, the Skill tool and StructuredOutput are served under. */
export const OFFICE_SERVER = "office";

/** The name the model calls an MCP tool by: `mcp_<server>_<tool>`. */
export function mcpToolName(server: string, tool: string): string {
  return `mcp_${server}_${tool}`;
}

/** The variable the run takes the file holding the Gemini API key from. */
export const GEMINI_API_KEY_FILE_VARIABLE = "ENGINE_CHECK_GEMINI_API_KEY_FILE";

/** The variable the CLI reads the Gemini API key from. */
export const GEMINI_API_KEY_VARIABLE = "GEMINI_API_KEY";

/**
 * The service's own relay (spec §5.4.7), which the CLI runs as its `BeforeTool` hook and as every
 * MCP server of a session: the check runs that very script, so what it observes is the adapter's
 * relay, its deadline and its refusals included. It is run by path, never imported.
 */
export const OFFICE_RELAY = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "..",
  "apps",
  "service",
  "src",
  "modules",
  "engine",
  "adapters",
  "gemini-cli",
  "gemini-office-relay.ts",
);
