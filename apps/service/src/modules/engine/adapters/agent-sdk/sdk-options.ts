import {
  createSdkMcpServer,
  tool,
  type HookCallback,
  type McpSdkServerConfigWithInstance,
  type Options,
  type Settings,
} from "@anthropic-ai/claude-agent-sdk";
import { isOfficeOwnVariable } from "../../../../platform/config/office-config.js";
import type { AgentShell } from "../../../../platform/os/shell.js";
import type { OfficeTool } from "../../ports/office-tool.js";
import type { SessionOptions } from "../../ports/session-options.js";

/** The in-process MCP server that holds a session's Office tools. */
export const OFFICE_TOOL_SERVER = "office";

/** What the engine calls an Office tool by. */
export const OFFICE_TOOL_PREFIX = `mcp__${OFFICE_TOOL_SERVER}__`;

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

export interface SdkSession {
  readonly id: string;
  /** Whether the session continues an ended one with its conversation. */
  readonly resumes: boolean;
  readonly options: SessionOptions;
  /** The shells Agents run commands in on this system. */
  readonly agentShells: readonly AgentShell[];
  /** Decides every tool call by the Office rules. */
  readonly preToolUse: HookCallback;
  /** Starts the engine's process. */
  readonly spawnProcess: NonNullable<Options["spawnClaudeCodeProcess"]>;
}

/**
 * The Agent SDK's options for one Office session (spec §5.4, §5.6, §6), as the engine check
 * measured them (docs/engine-check.md).
 */
export function sdkOptions({
  id,
  resumes,
  options,
  agentShells,
  preToolUse,
  spawnProcess,
}: SdkSession): Options {
  return {
    cwd: options.folder,
    model: options.model,
    effort: options.effort,
    tools: [...BUILT_IN_TOOLS, ...agentShells.map((shell) => SHELL_TOOLS[shell])].toSorted(),
    settingSources: ["project"],
    plugins:
      options.skills === undefined
        ? []
        : [{ type: "local", path: options.skills.folder, skipMcpDiscovery: true }],
    // The session folder holds only the session's skills; the allowlist keeps the rest unlisted.
    skills: [...(options.skills?.names ?? [])],
    settings: sessionSettings(options),
    permissionPrompts: "none",
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      excludeDynamicSections: true,
      ...(options.instructions !== "" && { append: options.instructions }),
    },
    env: sessionEnvironment(options.environment),
    hooks: { PreToolUse: [{ hooks: [preToolUse] }] },
    ...(options.officeTools.length > 0 && {
      mcpServers: { [OFFICE_TOOL_SERVER]: officeToolServer(options.officeTools, id) },
    }),
    ...(options.outputSchema !== undefined && {
      outputFormat: { type: "json_schema", schema: { ...options.outputSchema } },
    }),
    ...(resumes ? { resume: id } : { sessionId: id }),
    spawnClaudeCodeProcess: spawnProcess,
  };
}

function sessionSettings({ skills, officeTools }: SessionOptions): Settings {
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

/** Always loaded, so the Agent calls an Office tool without looking it up first. */
function officeToolServer(
  officeTools: readonly OfficeTool[],
  sessionId: string,
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: OFFICE_TOOL_SERVER,
    alwaysLoad: true,
    tools: officeTools.map((officeTool) =>
      tool(officeTool.name, officeTool.description, officeTool.input.shape, async (input) => {
        const result = await officeTool.run(input, { sessionId });
        return { content: [{ type: "text", text: result.text }], isError: result.isError };
      }),
    ),
  });
}
