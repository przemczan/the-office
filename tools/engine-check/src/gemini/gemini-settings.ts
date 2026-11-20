import { GEMINI_API_KEY_VARIABLE, mcpToolName } from "./options.ts";

/*
 * A session's settings as the adapter writes them; its `gemini-settings.ts` is the source of truth,
 * restated here because a tool imports no other workspace's code.
 */

/** The CLI's built-in tools a session gets (`tools.core`): no `activate_skill`, as skills come from the Skill tool. */
export const GEMINI_CORE_TOOLS = [
  "glob",
  "grep_search",
  "list_directory",
  "read_file",
  "replace",
  "run_shell_command",
  "write_file",
] as const;

/** How long the CLI waits for the hook before it lets the call run. */
export const HOOK_TIMEOUT_MS = 60_000;

/** How long the CLI waits for one MCP tool call, an Office tool's included. */
const MCP_CALL_TIMEOUT_MS = 10 * 60_000;

/** A stdio MCP server the CLI starts as its child: one of the relay's. */
export interface RelayServer {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
}

export interface GeminiSettingsParts {
  /** The `BeforeTool` command hook, which the CLI runs through its shell for every call. */
  readonly hookCommand: string;
  readonly mcpServers: readonly RelayServer[];
  /** The file holding the Agent's instructions, by its name in the home's `.gemini/`. */
  readonly instructionsFileName: string | undefined;
  /** The hook's timeout; the adapter's when omitted. A check shortens it only to see a timeout. */
  readonly hookTimeoutMs?: number;
}

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
      // never sees its calls (`gemini.tools-and-rules`).
      topicUpdateNarration: false,
    },
    experimental: { autoMemory: false },
    ide: { enabled: false },
    context: {
      fileName: [
        "GEMINI.md",
        ...(parts.instructionsFileName === undefined ? [] : [parts.instructionsFileName]),
      ],
    },
    tools: {
      core: [...GEMINI_CORE_TOOLS, ...parts.mcpServers.map(({ name }) => mcpToolName(name, "*"))],
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
              timeout: parts.hookTimeoutMs ?? HOOK_TIMEOUT_MS,
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

/**
 * The hook's command line as the service's operating system layer builds it
 * (`nodeScriptHookCommand`): the CLI runs a hook through `bash -c` on Linux, each word single-quoted,
 * and through PowerShell on Windows, where a quoted path is a string unless called with `&`.
 */
export function nodeScriptHookCommand(
  script: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
): string {
  const words = [process.execPath, script, ...args];
  return platform === "win32"
    ? `& ${words.map(powerShellQuoted).join(" ")}`
    : words.map(shQuoted).join(" ");
}

function shQuoted(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

function powerShellQuoted(word: string): string {
  return `'${word.replaceAll("'", "''")}'`;
}
