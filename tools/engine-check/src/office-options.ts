import type { HookEvent, Settings } from "@anthropic-ai/claude-agent-sdk";
import { dirname } from "node:path";
import type { RecordedSession, SessionHook } from "./recorded-session.ts";
import { SESSION_PLUGIN_NAME, type SkillFixture } from "./sandbox.ts";

/** The cheapest model that proves the point: checks observe the engine, not the model's quality. */
export const CHECK_MODEL = "claude-haiku-5-5";

/**
 * The engine's built-in plugins, turned off by id (spec §5.6); a release that adds one shows in
 * `skills.start-check` as another plugin beside the session's.
 */
const BUILT_IN_PLUGINS = [
  "cc-plugin-agents-md",
  "cc-plugin-telemetry",
  "cc-plugin-plugin-authoring",
];

/**
 * The built-in tools, named explicitly so both platforms get the same set (spec §5.4): the engine's
 * Linux default drops Grep and Glob for shell search. This is the Windows default of 2.1.310, and
 * LSP, which the engine drops from a session with no language server (`engine.lsp-tool`).
 */
export const OFFICE_TOOLS = [
  "Bash",
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
  ...(process.platform === "win32" ? ["PowerShell"] : []),
];

/** The MCP server that holds the Office tools (spec §5.4), in-process or on `localhost`. */
export const OFFICE_TOOL_SERVER = "office";

/** The name the model calls an Office tool by. */
export function officeToolName(tool: string): string {
  return `mcp__${OFFICE_TOOL_SERVER}__${tool}`;
}

/** Hook events the Office registers; a check registers more only when it observes them. */
export const OFFICE_HOOK_EVENTS: readonly HookEvent[] = [
  "PreToolUse",
  "PostToolUse",
  "PermissionDenied",
];

/** What a session is started with, whichever route starts it. */
export interface SessionSpecBase<S extends RecordedSession> {
  readonly repository: string;
  /** Copied into the session plugin folder. */
  readonly skills?: readonly SkillFixture[];
  /** The skills the session may run; defaults to `office:<name>` for each of `skills`. */
  readonly allowedSkills?: readonly string[];
  /** Further plugin folders loaded beside the session plugin. */
  readonly additionalPlugins?: readonly string[];
  /** Merged over the spec §5.4, §5.6 and §6 settings; `permissions` merges a level deeper. */
  readonly settings?: Settings;
  /** Decides a hook call; events without one are recorded and allowed to continue. */
  readonly hooks?: Partial<Record<HookEvent, SessionHook<S>>>;
  /** Session id to resume; the plugin folder is rebuilt from `skills`, as the Office does. */
  readonly resume?: string;
  /** Id for a new session, chosen up front as the Office does, since it names the plugin folder; random when omitted. */
  readonly sessionId?: string;
}

export function allowedSkillNames(
  spec: Pick<SessionSpecBase<RecordedSession>, "skills" | "allowedSkills">,
): string[] {
  return [
    ...(spec.allowedSkills ??
      (spec.skills ?? []).map((skill) => `${SESSION_PLUGIN_NAME}:${skill.name}`)),
  ];
}

/** Every event the session registers a hook for: the Office's, and any a check decides. */
export function hookEvents(hooks: Partial<Record<HookEvent, unknown>>): HookEvent[] {
  return [...new Set<HookEvent>([...OFFICE_HOOK_EVENTS, ...(Object.keys(hooks) as HookEvent[])])];
}

/** Where the engine finds instructions in a folder. */
const INSTRUCTION_FILES = ["CLAUDE.md", "CLAUDE.local.md", ".claude/CLAUDE.md", ".claude/rules/**"];

/**
 * The instruction files of every folder above the working folder, which the engine loads as the
 * Project's own unless its read fence is on; with it off (spec §6) they are excluded, so the user's
 * own `~/.claude/CLAUDE.md` never reaches a session whose folder is under their home folder.
 */
function instructionFilesAbove(workingFolder: string): string[] {
  const files: string[] = [];
  for (let above = dirname(workingFolder); ; above = dirname(above)) {
    const prefix = above.replaceAll("\\", "/").replace(/\/$/, "");
    files.push(...INSTRUCTION_FILES.map((file) => `${prefix}/${file}`));
    if (dirname(above) === above) return files;
  }
}

/** The settings of spec §5.4, §5.6 and §6 for a session in `workingFolder`, with a check's overrides. */
export function sessionSettings(workingFolder: string, overrides: Settings = {}): Settings {
  return {
    syncClaudeAiSkills: false,
    syncClaudeAiPlugins: false,
    disableBundledSkills: true,
    disableSkillShellExecution: true,
    disableClaudeAiConnectors: true,
    autoMemoryEnabled: false,
    autoDreamEnabled: false,
    enabledPlugins: Object.fromEntries(
      BUILT_IN_PLUGINS.map((plugin) => [`${plugin}@builtin`, false]),
    ),
    claudeMdExcludes: instructionFilesAbove(workingFolder),
    ...overrides,
    // The hook alone fences reads (spec §6, permissions.read-fence-off).
    permissions: { blockReadsOutsideWorkingDirectories: false, ...overrides.permissions },
  };
}
