import type { Settings } from "@anthropic-ai/claude-agent-sdk";
import { dirname } from "node:path";
import { isOfficeOwnVariable } from "../../../../platform/config/office-config.js";
import type { AgentShell } from "../../../../platform/os/shell.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { OFFICE_TOOL_SERVER } from "../office-rules/office-tool-names.js";

/**
 * The engine's built-in tools besides the shells, named explicitly so both systems get the same
 * set (spec §5.4): the Linux default drops Grep and Glob. The Windows default of Claude Code 2.1.310,
 * and LSP, which the engine drops from a session with no language server.
 */
const BUILT_IN_TOOLS = [
  "CronCreate",
  "CronDelete",
  "CronList",
  "DesignSync",
  "Edit",
  "EnterWorktree",
  "ExitWorktree",
  "Glob",
  "Grep",
  "ListAgents",
  "LSP",
  "Monitor",
  "NotebookEdit",
  "PushNotification",
  "Read",
  "RemoteTrigger",
  "ReportFindings",
  "ScheduleWakeup",
  "SendMessage",
  "Skill",
  "Task",
  "TaskStop",
  "ToolSearch",
  "WebSearch",
  "Workflow",
  "Write",
];

const SHELL_TOOLS: Readonly<Record<AgentShell, string>> = {
  bash: "Bash",
  powershell: "PowerShell",
};

/**
 * The engine's built-in plugins, each turned off by id (spec §5.4). A release that adds one shows
 * in the engine check's `skills.start-check` as another plugin.
 */
const BUILT_IN_PLUGINS = [
  "cc-plugin-agents-md",
  "cc-plugin-telemetry",
  "cc-plugin-plugin-authoring",
];

/**
 * Variables of the engine's a session must not get: an API key would switch billing off the
 * subscription, a given `CLAUDE_CONFIG_DIR` would run it on another account than its engine's,
 * `CLAUDE_CODE_PLUGIN_DIRS` changes what loads, and a parent
 * Claude Code session's own variables would make the session a nested one.
 */
const ENGINE_VARIABLE_PREFIXES = ["CLAUDE", "ANTHROPIC", "MCP_", "OTEL_"];

/** The engine's tools a session gets, the same set on both systems (spec §5.4). */
export function sessionTools(agentShells: readonly AgentShell[]): string[] {
  return [...BUILT_IN_TOOLS, ...agentShells.map((shell) => SHELL_TOOLS[shell])].toSorted();
}

/** Where the engine finds instructions in a folder. */
const INSTRUCTION_FILES = ["CLAUDE.md", "CLAUDE.local.md", ".claude/CLAUDE.md", ".claude/rules/**"];

/**
 * The instruction files of every folder above a session's folder. Without its read fence the engine
 * loads them as the Project's own, so the user's `~/.claude/CLAUDE.md` would reach every session whose
 * folder is under their home folder (spec §6, the engine check's permissions.read-fence-off).
 */
function instructionFilesAbove(folder: string): string[] {
  const files: string[] = [];
  for (let above = dirname(folder); ; above = dirname(above)) {
    const prefix = above.replaceAll("\\", "/").replace(/\/$/, "");
    files.push(...INSTRUCTION_FILES.map((file) => `${prefix}/${file}`));
    if (dirname(above) === above) return files;
  }
}

/** The settings of spec §5.4, §5.6 and §6 a session runs with, hooks aside. */
export function sessionSettings({
  folder,
  skills,
  officeTools,
  mcpServers,
}: SessionOptions): Settings {
  return {
    claudeMdExcludes: instructionFilesAbove(folder),
    syncClaudeAiSkills: false,
    syncClaudeAiPlugins: false,
    disableBundledSkills: true,
    // A skill's text runs no command as it loads; the Agent runs it, through the hook.
    disableSkillShellExecution: true,
    skillOverrides: { ...skills?.overrides },
    disableClaudeAiConnectors: true,
    autoMemoryEnabled: false,
    // Near its context limit a session hands over and ends; nothing summarizes it (spec §2.5).
    autoCompactEnabled: false,
    idleCompaction: false,
    autoDreamEnabled: false,
    enabledPlugins: Object.fromEntries(
      BUILT_IN_PLUGINS.map((plugin) => [`${plugin}@builtin`, false]),
    ),
    permissions: {
      // The hook alone fences reads: under the engine's read fence it refused shell commands the hook
      // allowed (spec §6, the engine check's permissions.read-fence-off).
      blockReadsOutsideWorkingDirectories: false,
      // permissionPrompts "none" refuses whatever would prompt, so the MCP servers' tools are allowed
      // by rule; the hook, which runs first, judges each call (engine check, engine.office-tool).
      allow: [
        ...(officeTools.length > 0 ? [OFFICE_TOOL_SERVER] : []),
        ...mcpServers.map(({ name }) => name),
      ].map((server) => `mcp__${server}`),
    },
  };
}

/**
 * The variables a session runs with: the given ones without the engine's, nor The Office's own,
 * which hold its database credentials (spec §6), whoever passed them; then the engine's own
 * config folder (`engineConfigFolder`), which holds its account.
 */
export function sessionEnvironment(
  environment: Readonly<Record<string, string>>,
  configFolder: string,
): Record<string, string> {
  return {
    ...Object.fromEntries(
      Object.entries(environment).filter(
        ([name]) =>
          !isOfficeOwnVariable(name) &&
          !ENGINE_VARIABLE_PREFIXES.some((prefix) => name.toUpperCase().startsWith(prefix)),
      ),
    ),
    CLAUDE_CONFIG_DIR: configFolder,
  };
}
