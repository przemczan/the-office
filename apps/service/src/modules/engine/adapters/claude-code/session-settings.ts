import type { Settings } from "@anthropic-ai/claude-agent-sdk";
import { isOfficeOwnVariable } from "../../../../platform/config/office-config.js";
import type { AgentShell } from "../../../../platform/os/shell.js";
import type { SessionOptions } from "../../ports/session-options.js";
import { OFFICE_TOOL_SERVER } from "./office-tools.js";

/**
 * The engine's built-in tools besides the shells, named explicitly so both systems get the same
 * set (spec §5.4): the Linux default drops Grep and Glob. The Windows default of Claude Code 2.1.310.
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
 * subscription, `CLAUDE_CONFIG_DIR` and `CLAUDE_CODE_PLUGIN_DIRS` change what loads, and a parent
 * Claude Code session's own variables would make the session a nested one.
 */
const ENGINE_VARIABLE_PREFIXES = ["CLAUDE", "ANTHROPIC", "MCP_", "OTEL_"];

/** The engine's tools a session gets, the same set on both systems (spec §5.4). */
export function sessionTools(agentShells: readonly AgentShell[]): string[] {
  return [...BUILT_IN_TOOLS, ...agentShells.map((shell) => SHELL_TOOLS[shell])].toSorted();
}

/** The settings of spec §5.4, §5.6 and §6 a session runs with, hooks aside. */
export function sessionSettings({ skills, officeTools }: SessionOptions): Settings {
  return {
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
      blockReadsOutsideWorkingDirectories: true,
      // Lets the file tools read the skills folder under the read fence, and nothing else (spec §5.6).
      additionalDirectories: skills === undefined ? [] : [skills.folder],
      // permissionPrompts "none" refuses whatever would prompt, so the Office tools are allowed by rule.
      allow: officeTools.length > 0 ? [`mcp__${OFFICE_TOOL_SERVER}`] : [],
    },
  };
}

/**
 * The variables a session runs with: the given ones without the engine's, nor The Office's own,
 * which hold its database credentials (spec §6), whoever passed them.
 */
export function sessionEnvironment(
  environment: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) =>
        !isOfficeOwnVariable(name) &&
        !ENGINE_VARIABLE_PREFIXES.some((prefix) => name.toUpperCase().startsWith(prefix)),
    ),
  );
}
