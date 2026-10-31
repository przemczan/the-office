import type { AgentAction } from "../../domain/agent-action.js";
import { OFFICE_TOOL_PREFIX } from "./office-tool-names.js";

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
      const patterns = braceAlternatives(field(input, "pattern"));
      return { kind: "read", paths: [folder, ...patterns.map((one) => globFolder(folder, one))] };
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

/**
 * The patterns a glob's braces stand for, so an alternative naming another folder (`{src,/etc}/*`)
 * is judged on its own. Since the hook alone fences the file tools (spec §6), nothing behind it would.
 */
function braceAlternatives(pattern: string): string[] {
  const open = pattern.indexOf("{");
  const close = open === -1 ? -1 : matchingBrace(pattern, open);
  if (close === -1) return [pattern];
  const before = pattern.slice(0, open);
  const after = pattern.slice(close + 1);
  return topLevelParts(pattern.slice(open + 1, close)).flatMap((part) =>
    braceAlternatives(`${before}${part}${after}`),
  );
}

function matchingBrace(pattern: string, open: number): number {
  let depth = 0;
  for (let index = open; index < pattern.length; index++) {
    if (pattern[index] === "{") depth++;
    if (pattern[index] === "}" && --depth === 0) return index;
  }
  return -1;
}

/** The comma-separated parts of a brace's inside, nested braces kept whole. */
function topLevelParts(inside: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < inside.length; index++) {
    if (inside[index] === "{") depth++;
    if (inside[index] === "}") depth--;
    if (inside[index] === "," && depth === 0) {
      parts.push(inside.slice(start, index));
      start = index + 1;
    }
  }
  return [...parts, inside.slice(start)];
}

/**
 * The folder a glob pattern searches, before its first wildcard, which an absolute pattern names
 * itself; each `..` after a wildcard climbs from there, so the fence judges the highest folder reached.
 */
function globFolder(folder: string, pattern: string): string {
  const names = pattern.split(/[\\/]/);
  const wildcard = names.findIndex((name) => /[*?[]/.test(name));
  const fixedNames = wildcard === -1 ? names.slice(0, -1) : names.slice(0, wildcard);
  const climbs = wildcard === -1 ? [] : names.slice(wildcard).filter((name) => name === "..");
  const fixed = [...fixedNames, ...climbs].join("/");
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
