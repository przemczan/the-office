import type { ToolDecision } from "../../domain/office-rules.js";
import { SKILL_TOOL } from "../../domain/skill-calls.js";
import {
  mcpToolName,
  OFFICE_TOOL_SERVER,
  portToolName,
} from "../office-rules/office-tool-names.js";
import { STRUCTURED_OUTPUT_TOOL } from "../structured-output/structured-output.js";

/*
 * What a Gemini CLI tool call is to the Office rules (spec §5.4.7): the CLI's core tools, the Office
 * tool server's and the session's MCP servers' are put into the Claude Code tools the rules judge,
 * with the input in the shape `agentAction` reads, so the rules stay one set for every engine.
 */

/** A call as the Office rules judge it, and as the port reports it: a Claude Code tool and its input. */
export interface GeminiCall {
  readonly tool: string;
  readonly officeTool: boolean;
  readonly input: unknown;
}

export type GeminiToolJudgement =
  | { readonly kind: "judged"; readonly call: GeminiCall }
  | { readonly kind: "refused"; readonly reason: string };

/** What the session knows of its own tools. */
export interface GeminiToolSession {
  /** The session's MCP servers, as the CLI knows them, the Office tool server not among them. */
  readonly mcpServerNames: readonly string[];
  /** The shell `run_shell_command` runs in: bash, or PowerShell on Windows. */
  readonly shell: "Bash" | "PowerShell";
}

/** Who named the call: the CLI's own tool name and, for an MCP tool, its server and tool. */
export interface GeminiToolUse {
  readonly toolName: string;
  readonly input: unknown;
  readonly mcpServer?: string | undefined;
  readonly mcpTool?: string | undefined;
}

const BACKGROUND_REFUSAL =
  "Refused by The Office: a command can't run in the background on this engine, as it would outlive Stop. Run it in the foreground.";

/**
 * Puts one CLI tool call into the tools the Office rules judge, as the `BeforeTool` hook asks, and
 * as the Thread shows it:
 *
 * - `read_file`: Read; `write_file`: Write; `replace`: Edit;
 * - `glob`: Glob; `grep_search`: Grep; `list_directory`: a Glob of the folder;
 * - `run_shell_command`: Bash, or PowerShell on Windows, the call's `dir_path` as a change of folder
 *   first; refused with `is_background`, since a background command outlives Stop;
 * - `mcp_office_<tool>`: the Office tool by its own name, but `Skill` and `StructuredOutput`, which
 *   are the engine's own tools under Claude Code's names;
 * - `mcp_<server>_<tool>` of one of the session's MCP servers: `mcp__<server>__<tool>`;
 * - any other tool: refused, never allowed by default.
 */
export function geminiToolCall(
  use: GeminiToolUse,
  session: GeminiToolSession,
): GeminiToolJudgement {
  const builtIn = builtInCall(use, session);
  if (builtIn !== undefined) return builtIn;
  const mcp = mcpCallOf(use, session.mcpServerNames);
  return mcp ?? refusal(`Not available in The Office: the ${use.toolName} tool.`);
}

function builtInCall(
  { toolName, input }: GeminiToolUse,
  session: GeminiToolSession,
): GeminiToolJudgement | undefined {
  switch (toolName) {
    case "read_file":
      return judged("Read", { file_path: text(input, "file_path") });
    case "write_file":
      return judged("Write", {
        file_path: text(input, "file_path"),
        content: text(input, "content"),
      });
    case "replace":
      return judged("Edit", {
        file_path: text(input, "file_path"),
        old_string: text(input, "old_string"),
        new_string: text(input, "new_string"),
      });
    case "glob":
      return judged("Glob", pathed(text(input, "pattern"), text(input, "dir_path")));
    case "grep_search":
      return judged("Grep", pathed(text(input, "pattern"), text(input, "dir_path")));
    case "list_directory":
      return judged("Glob", pathed("*", text(input, "dir_path")));
    case "run_shell_command":
      return shellCall(input, session.shell);
    default:
      return undefined;
  }
}

function shellCall(input: unknown, shell: GeminiToolSession["shell"]): GeminiToolJudgement {
  if (asRecord(input)?.["is_background"] === true) return refusal(BACKGROUND_REFUSAL);
  const command = text(input, "command");
  const folder = text(input, "dir_path");
  return judged(shell, {
    command: folder === "" ? command : `${changeOfFolder(shell, folder)}${command}`,
    description: text(input, "description"),
  });
}

/** The CLI runs a command with `dir_path` in that folder, which the rules judge as a `cd` first. */
function changeOfFolder(shell: GeminiToolSession["shell"], folder: string): string {
  return shell === "Bash"
    ? `cd '${folder.replaceAll("'", `'\\''`)}' && `
    : `Set-Location -LiteralPath '${folder.replaceAll("'", "''")}'; `;
}

function mcpCallOf(
  { toolName, input, mcpServer, mcpTool }: GeminiToolUse,
  servers: readonly string[],
): GeminiToolJudgement | undefined {
  const named = namedMcpTool(toolName, mcpServer, mcpTool, [OFFICE_TOOL_SERVER, ...servers]);
  if (named === undefined) return undefined;
  const given = input ?? {};
  if (named.server !== OFFICE_TOOL_SERVER) {
    return judged(mcpToolName(named.server, named.tool), given);
  }
  if (named.tool === SKILL_TOOL || named.tool === STRUCTURED_OUTPUT_TOOL) {
    return judged(named.tool, given);
  }
  return {
    kind: "judged",
    call: { tool: mcpToolName(OFFICE_TOOL_SERVER, named.tool), officeTool: true, input: given },
  };
}

/**
 * The server and tool of an MCP call: as the hook's `mcp_context` names them when it does, else by
 * the longest `mcp_<server>_` of the session's servers that the call's name starts with. Only the
 * session's own servers count.
 */
function namedMcpTool(
  toolName: string,
  mcpServer: string | undefined,
  mcpTool: string | undefined,
  servers: readonly string[],
): { readonly server: string; readonly tool: string } | undefined {
  if (mcpServer !== undefined && mcpTool !== undefined) {
    return servers.includes(mcpServer) ? { server: mcpServer, tool: mcpTool } : undefined;
  }
  const server = servers
    .filter((name) => toolName.startsWith(`mcp_${name}_`) && toolName.length > name.length + 5)
    .toSorted((one, other) => other.length - one.length)[0];
  if (server === undefined) return undefined;
  return { server, tool: toolName.slice(server.length + 5) };
}

/**
 * The call as the port reports it: named as the Office rules judge it, so a Thread shows a Gemini
 * CLI call as another engine's and a Skill call counts as one, but an Office tool by its own name; an
 * unknown tool by the CLI's name.
 */
export function displayedCall(use: GeminiToolUse, session: GeminiToolSession): GeminiCall {
  const judgement = geminiToolCall(use, session);
  if (judgement.kind === "refused") {
    return { tool: use.toolName, officeTool: false, input: use.input ?? {} };
  }
  const { call } = judgement;
  return call.officeTool ? { ...call, tool: portToolName(call.tool) } : call;
}

/**
 * Judges a call by `decide`, the Office rules' decision of one Claude Code tool call (`toolDecision`
 * with the session's rules and holds). A call the translation refused is refused in its words, with
 * no decision asked, as it names nothing the rules could judge.
 */
export async function geminiDecision(
  judgement: GeminiToolJudgement,
  decide: (tool: string, input: unknown) => Promise<ToolDecision>,
): Promise<ToolDecision> {
  if (judgement.kind === "refused") return { allowed: false, reason: judgement.reason };
  return decide(judgement.call.tool, judgement.call.input);
}

function judged(tool: string, input: unknown): GeminiToolJudgement {
  return { kind: "judged", call: { tool, officeTool: false, input } };
}

function refusal(reason: string): GeminiToolJudgement {
  return { kind: "refused", reason };
}

/** `Glob`'s and `Grep`'s input with the folder left out when the call names none, as Claude Code's is. */
function pathed(pattern: string, path: string): Record<string, string> {
  return path === "" ? { pattern } : { pattern, path };
}

function text(input: unknown, name: string): string {
  const value = asRecord(input)?.[name];
  return typeof value === "string" ? value : "";
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;
}
