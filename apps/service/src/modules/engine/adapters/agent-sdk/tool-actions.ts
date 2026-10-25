import type { AgentAction } from "../../domain/agent-action.js";
import { OFFICE_TOOL_PREFIX } from "./sdk-options.js";

/**
 * The engine's tools of its own workings, allowed under every profile: loading a skill or a
 * deferred tool, a subagent (whose own calls come to the hook too; `init` lists it as Task, a call
 * names it Agent), a turn's structured output, and stopping a background command.
 */
const ENGINE_TOOLS: ReadonlySet<string> = new Set([
  "Skill",
  "ToolSearch",
  "Task",
  "Agent",
  "StructuredOutput",
  "TaskStop",
]);

const WEB_TOOLS: ReadonlySet<string> = new Set(["WebSearch", "WebFetch"]);

/**
 * What a Claude Code tool call does, as the Office rules judge it. A tool not named here is one
 * The Office doesn't give Agents, though the explicit tool list keeps it in the cached prefix:
 * leaving the worktree, scheduling, notifying, messaging other sessions, starting workflows.
 */
export function agentAction(tool: string, input: unknown): AgentAction {
  if (tool.startsWith(OFFICE_TOOL_PREFIX)) return { kind: "office-tool" };
  if (ENGINE_TOOLS.has(tool)) return { kind: "engine" };
  if (WEB_TOOLS.has(tool)) return { kind: "web" };
  switch (tool) {
    case "Read":
      return { kind: "read", paths: [field(input, "file_path")] };
    case "Grep":
      return { kind: "read", paths: [field(input, "path") || "."] };
    case "Glob": {
      const folder = field(input, "path") || ".";
      return { kind: "read", paths: [folder, globFolder(folder, field(input, "pattern"))] };
    }
    case "Edit":
    case "Write":
      return { kind: "edit", paths: [field(input, "file_path")] };
    case "NotebookEdit":
      return { kind: "edit", paths: [field(input, "notebook_path")] };
    case "Bash":
      return { kind: "command", dialect: "bash", commandLine: field(input, "command") };
    case "PowerShell":
      return { kind: "command", dialect: "powershell", commandLine: field(input, "command") };
    case "Monitor":
      return monitorAction(input);
    default:
      return { kind: "unavailable", tool };
  }
}

/** The Monitor tool watches a command it runs, or a WebSocket. */
function monitorAction(input: unknown): AgentAction {
  const commandLine = field(input, "command");
  if (commandLine !== "") return { kind: "command", dialect: "bash", commandLine };
  return typeof input === "object" && input !== null && "ws" in input
    ? { kind: "web" }
    : { kind: "engine" };
}

/** The folder a glob pattern searches, before its first wildcard, which an absolute pattern names itself. */
function globFolder(folder: string, pattern: string): string {
  const names = pattern.split(/[\\/]/);
  const wildcard = names.findIndex((name) => /[*?[{]/.test(name));
  const fixed = (wildcard === -1 ? names.slice(0, -1) : names.slice(0, wildcard)).join("/");
  return /^([a-zA-Z]:)?[\\/]/.test(pattern) ? fixed || "/" : `${folder}/${fixed}`;
}

/** A text field of a tool's input; the engine validated the input before the hook sees it. */
function field(input: unknown, name: string): string {
  const value =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)[name]
      : undefined;
  return typeof value === "string" ? value : "";
}
