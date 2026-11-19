import type { ToolDecision } from "../../domain/office-rules.js";
import { SKILL_TOOL } from "../../domain/skill-calls.js";
import { mcpToolName, OFFICE_TOOL_SERVER } from "../office-rules/office-tool-names.js";

/*
 * What a Copilot CLI tool call is to the Office rules (spec §5.4, the Copilot CLI engine): the
 * runtime's tools, MCP tools and Office tools are put into the Claude Code tools the rules judge,
 * with the input in the shape `agentAction` reads, so the rules stay one set for every engine.
 */

/** A call as the Office rules judge it: a Claude Code tool and its input. */
export interface JudgedCall {
  readonly tool: string;
  readonly input: unknown;
}

/** A call as the port reports it, so a Thread shows it as another engine's. */
export interface DisplayedCall {
  readonly tool: string;
  readonly officeTool: boolean;
  readonly input: unknown;
}

/**
 * What the session knows of its own tools: the names of its Office tools and of its MCP servers,
 * as the runtime was given them.
 */
export interface CopilotToolSession {
  readonly officeToolNames: ReadonlySet<string>;
  readonly mcpServerNames: readonly string[];
}

export type CopilotToolJudgement =
  | {
      readonly kind: "judged";
      /** Every one must be allowed for the call to run: a patch names a file per call. */
      readonly calls: readonly JudgedCall[];
      /** The one tool call the port reports, whatever the number of judged calls. */
      readonly display: DisplayedCall;
    }
  | { readonly kind: "refused"; readonly reason: string };

/** Calls shown as the first of them, unless `display` says how else. */
function judged(calls: readonly JudgedCall[], display?: DisplayedCall): CopilotToolJudgement {
  const [first] = calls;
  if (first === undefined) return refusal("The call names nothing to act on.");
  return { kind: "judged", calls, display: display ?? { ...first, officeTool: false } };
}

function refusal(reason: string): CopilotToolJudgement {
  return { kind: "refused", reason };
}

/**
 * Puts one runtime tool call into the tools the Office rules judge, when the pre-tool-use hook asks:
 *
 * - `bash` / `powershell`: Bash / PowerShell (`detach` or `mode: "async"` is `run_in_background`);
 * - `read_bash`, `list_bash`, `stop_bash`: TaskStop, the engine's own management of a command the
 *   rules already allowed to start, allowed under every profile;
 * - `view`: Read; `glob`: Glob; `grep` and `rg`: a Grep of each path they name;
 * - `create`: Write; `edit`: Edit; `apply_patch`: a Write or an Edit of each file the patch names;
 * - `web_fetch`: WebFetch; `skill`: Skill;
 * - `task` and the `*_agent` tools: refused, as sessions start no Sub-agents on this engine until
 *   the engine check shows a Sub-agent's own calls reach the hook (spec §5.4);
 * - an MCP tool `<server>-<tool>` of the longest server name that fits: `mcp__<server>__<tool>`;
 * - an Office tool by its own name: `mcp__office__<name>`;
 * - any other tool: refused, never allowed by default.
 *
 * A built-in name wins over an Office tool's of the same name, so an Office tool can't dodge the rules
 * by taking a built-in's name.
 *
 * The caller judges every `calls` entry with `toolDecision` (or `judgedByRules`) and lets the call
 * run only when each is allowed; `display` is what the Thread shows: for a patch of one file that
 * file's Write or Edit, for several `apply_patch` with the list of the files in its input.
 */
export function copilotToolCall(
  toolName: string,
  toolArgs: unknown,
  session: CopilotToolSession,
): CopilotToolJudgement {
  const builtIn = builtInCall(toolName, toolArgs);
  if (builtIn !== undefined) return builtIn;
  if (session.officeToolNames.has(toolName)) return officeToolCall(toolName, toolArgs);
  const mcp = mcpCallOf(toolName, toolArgs, session.mcpServerNames);
  return mcp ?? refusal(`Not available in The Office: the ${toolName} tool.`);
}

/** An Office tool is shown by its own name, which the port wants as it is. */
function officeToolCall(toolName: string, toolArgs: unknown): CopilotToolJudgement {
  const input = toolArgs ?? {};
  return judged([{ tool: mcpToolName(OFFICE_TOOL_SERVER, toolName), input }], {
    tool: toolName,
    officeTool: true,
    input,
  });
}

function mcpCallOf(
  toolName: string,
  toolArgs: unknown,
  servers: readonly string[],
): CopilotToolJudgement | undefined {
  const server = servers
    .filter((name) => toolName.startsWith(`${name}-`) && toolName.length > name.length + 1)
    .toSorted((one, other) => other.length - one.length)[0];
  if (server === undefined) return undefined;
  return judged([
    { tool: mcpToolName(server, toolName.slice(server.length + 1)), input: toolArgs ?? {} },
  ]);
}

const SUB_AGENT_REFUSAL =
  "Sub-agents aren't available on this engine yet: its sessions start none.";

function builtInCall(toolName: string, args: unknown): CopilotToolJudgement | undefined {
  switch (toolName) {
    case "bash":
      return shellCall("Bash", args);
    case "powershell":
      return shellCall("PowerShell", args);
    case "read_bash":
    case "list_bash":
    case "stop_bash":
      return judged([{ tool: "TaskStop", input: args ?? {} }]);
    case "view":
      return judged([{ tool: "Read", input: { file_path: text(args, "path", "file_path") } }]);
    case "glob":
      return judged([{ tool: "Glob", input: pathed(args, "pattern", text(args, "path")) }]);
    case "grep":
    case "rg":
      return searchCall(args);
    case "create":
      return judged([
        {
          tool: "Write",
          input: {
            file_path: text(args, "path", "file_path"),
            content: text(args, "file_text", "content"),
          },
        },
      ]);
    case "edit":
      return judged([
        {
          tool: "Edit",
          input: {
            file_path: text(args, "path", "file_path"),
            old_string: text(args, "old_str", "old_string"),
            new_string: text(args, "new_str", "new_string"),
          },
        },
      ]);
    case "apply_patch":
      return patchCall(args);
    case "web_fetch":
      return judged([
        { tool: "WebFetch", input: { url: text(args, "url"), prompt: text(args, "prompt") } },
      ]);
    case "skill":
      return judged([{ tool: SKILL_TOOL, input: { skill: text(args, "skill", "name") } }]);
    case "task":
    case "list_agents":
    case "read_agent":
    case "write_agent":
      return refusal(SUB_AGENT_REFUSAL);
    default:
      return toolName.endsWith("_agent") ? refusal(SUB_AGENT_REFUSAL) : undefined;
  }
}

function shellCall(tool: "Bash" | "PowerShell", args: unknown): CopilotToolJudgement {
  const background = flag(args, "detach") || text(args, "mode") === "async";
  return judged([
    {
      tool,
      input: {
        command: text(args, "command"),
        description: text(args, "description"),
        run_in_background: background,
      },
    },
  ]);
}

/** `Glob`'s input with the folder left out when the call names none, as Claude Code's is. */
function pathed(args: unknown, patternField: string, path: string): Record<string, string> {
  const pattern = text(args, patternField);
  return path === "" ? { pattern } : { pattern, path };
}

/** grep names one `path`, rg a list of `paths`: one Grep of each, so each folder is judged. */
function searchCall(args: unknown): CopilotToolJudgement {
  const paths = [text(args, "path"), ...strings(args, "paths")].filter((path) => path !== "");
  const folders = paths.length === 0 ? [""] : paths;
  return judged(folders.map((path) => ({ tool: "Grep", input: pathed(args, "pattern", path) })));
}

// ---- apply_patch ----

const PATCH_FILE_LINE = /^\*\*\* (Add File|Update File|Delete File|Move to): (.+?)\s*$/;

/**
 * A patch in the V4A form (`*** Begin Patch`, `*** Add File: <path>`, `*** Update File: <path>`,
 * `*** Delete File: <path>`, `*** Move to: <path>`), as the runtime's text or a string field of its
 * arguments. A file added is a Write; one updated or deleted an Edit; the target of a move a Write
 * too, since the move creates it. A patch naming no file is refused: it can't be judged.
 */
function patchCall(args: unknown): CopilotToolJudgement {
  const patch = patchText(args);
  if (patch === undefined) return refusal("The patch couldn't be read: it is no text.");
  const calls: JudgedCall[] = [];
  for (const line of patch.split(/\r?\n/)) {
    const [, kind, path] = PATCH_FILE_LINE.exec(line) ?? [];
    if (kind === undefined || path === undefined) continue;
    const tool = kind === "Add File" || kind === "Move to" ? "Write" : "Edit";
    if (!calls.some((call) => call.tool === tool && fileOf(call) === path)) {
      calls.push({ tool, input: { file_path: path } });
    }
  }
  if (calls.length === 0) return refusal("The patch couldn't be read: it names no file.");
  return judged(calls, patchDisplay(calls));
}

function patchText(args: unknown): string | undefined {
  if (typeof args === "string") return args;
  for (const name of ["input", "patch", "text"]) {
    const value = text(args, name);
    if (value !== "") return value;
  }
  return undefined;
}

function fileOf({ input }: JudgedCall): string {
  return text(input, "file_path");
}

/** One file is shown as its own Write or Edit; several as the patch, with the files it touches. */
function patchDisplay(calls: readonly JudgedCall[]): DisplayedCall | undefined {
  if (calls.length === 1) return undefined;
  return {
    tool: "apply_patch",
    officeTool: false,
    input: { files: calls.map((call) => ({ tool: call.tool, file_path: fileOf(call) })) },
  };
}

// ---- Reading the arguments ----

function text(input: unknown, ...names: string[]): string {
  const record = asRecord(input);
  for (const name of names) {
    const value = record?.[name];
    if (typeof value === "string") return value;
  }
  return "";
}

function flag(input: unknown, name: string): boolean {
  return asRecord(input)?.[name] === true;
}

function strings(input: unknown, name: string): string[] {
  const value = asRecord(input)?.[name];
  return Array.isArray(value) ? value.filter((one): one is string => typeof one === "string") : [];
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;
}

// ---- Judging ----

/**
 * Judges a call by `decide`, the Office rules' decision of one Claude Code tool call (`toolDecision`
 * with the session's rules and holds): the first call refused is the answer, with its reason; a call
 * is allowed when every one of its calls is. A call the translation refused is refused in its words,
 * with no decision asked, as it names nothing the rules could judge.
 */
export async function copilotDecision(
  judgement: CopilotToolJudgement,
  decide: (tool: string, input: unknown) => Promise<ToolDecision>,
): Promise<ToolDecision> {
  if (judgement.kind === "refused") return { allowed: false, reason: judgement.reason };
  for (const { tool, input } of judgement.calls) {
    const decision = await decide(tool, input);
    if (!decision.allowed) return decision;
  }
  return { allowed: true };
}
