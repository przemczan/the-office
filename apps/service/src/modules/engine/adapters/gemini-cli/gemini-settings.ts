import { GEMINI_API_KEY_VARIABLE } from "./gemini-environment.js";

/**
 * The CLI's built-in tools a session gets (`tools.core`; spec §5.4.7): the file tools and the shell,
 * each judged by the Office rules (`gemini-tool-actions.ts`). Not `activate_skill`, as a session's
 * skills come from the Office tool server's Skill tool, nor the web, memory, todo, planning or agent
 * tools.
 */
export const GEMINI_CORE_TOOLS = [
  "glob",
  "grep_search",
  "list_directory",
  "read_file",
  "replace",
  "run_shell_command",
  "write_file",
] as const;

/**
 * How long the CLI waits for the hook before it lets the call run (the engine check,
 * `gemini.hook-unreachable`); the relay refuses at its own, shorter deadline (`RELAY_DEADLINE_MS`).
 */
export const HOOK_TIMEOUT_MS = 60_000;

/** How long the CLI waits for one MCP tool call, an Office tool's included. */
const MCP_CALL_TIMEOUT_MS = 10 * 60_000;

/** The name the model calls an MCP tool by: `mcp_<server>_<tool>`. */
export function geminiMcpToolName(server: string, tool: string): string {
  return `mcp_${server}_${tool}`;
}

/** A stdio MCP server the CLI starts as its child: one of the relay's. */
export interface RelayServer {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
}

export interface GeminiSettingsParts {
  /** The `BeforeTool` command hook, which the CLI runs through its shell for every call. */
  readonly hookCommand: string;
  /** The Office tool server and each MCP server of the session, all relays to the service. */
  readonly mcpServers: readonly RelayServer[];
  /** The file holding the Agent's instructions, by its name in the home's `.gemini/`. */
  readonly instructionsFileName: string | undefined;
}

/**
 * One session's settings, the user settings of the session's own home
 * (`<home>/.gemini/settings.json`, `preparedGeminiSessionHome`), as the engine check ran them
 * (docs/engine-check.md, "Gemini CLI"): signed in by the key in its environment; folder trust off,
 * so the hook and the MCP servers load; no telemetry, usage statistics, auto update, checkpointing, auto memory, IDE or chat
 * retention sweep; the key redacted from what its shell commands, hooks and MCP servers inherit; its
 * own skill loading off; the core tools and each MCP server's tools named, as headless the CLI hides
 * any tool `tools.core` leaves out; the Office hook on every call. No Server value or token is in it:
 * the relays read theirs from the session's channel file.
 */
export function geminiSettings(parts: GeminiSettingsParts): Record<string, unknown> {
  return {
    security: {
      auth: { selectedType: "gemini-api-key" },
      folderTrust: { enabled: false },
      disableAlwaysAllow: true,
      environmentVariableRedaction: { enabled: true, blocked: [GEMINI_API_KEY_VARIABLE] },
    },
    privacy: { usageStatisticsEnabled: false },
    telemetry: { enabled: false },
    general: {
      enableAutoUpdate: false,
      enableAutoUpdateNotification: false,
      checkpointing: { enabled: false },
      sessionRetention: { enabled: false },
      // On by default, it gives the model `update_topic` whatever `tools.core` says, and the hook
      // never sees its calls (the engine check, `gemini.tools-and-rules`).
      topicUpdateNarration: false,
    },
    experimental: { autoMemory: false },
    ide: { enabled: false },
    // The repository's GEMINI.md is the Project's instructions; the Agent's own come from a file of
    // the session's in the home's `.gemini/`, which the CLI reads as its global memory.
    context: {
      fileName: [
        "GEMINI.md",
        ...(parts.instructionsFileName === undefined ? [] : [parts.instructionsFileName]),
      ],
    },
    tools: {
      core: [
        ...GEMINI_CORE_TOOLS,
        ...parts.mcpServers.map(({ name }) => geminiMcpToolName(name, "*")),
      ],
    },
    skills: { enabled: false },
    hooksConfig: { enabled: true },
    hooks: {
      BeforeTool: [
        {
          matcher: ".*",
          hooks: [
            {
              name: "office",
              type: "command",
              command: parts.hookCommand,
              timeout: HOOK_TIMEOUT_MS,
            },
          ],
        },
      ],
    },
    mcpServers: Object.fromEntries(
      parts.mcpServers.map(({ name, command, args }) => [
        name,
        { command, args: [...args], timeout: MCP_CALL_TIMEOUT_MS },
      ]),
    ),
  };
}
