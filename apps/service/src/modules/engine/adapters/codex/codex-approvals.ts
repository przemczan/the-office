import type { PathRules } from "../../../../platform/os/path-rules.js";
import type { AgentShell } from "../../../../platform/os/shell.js";
import {
  programName,
  simpleCommands,
  type ShellDialect,
  type SimpleCommand,
} from "../../domain/shell-commands.js";
import type { ToolDecider } from "../office-rules/office-tool-call.js";
import { mcpToolName, portToolName } from "../office-rules/office-tool-names.js";
import {
  COMMAND_APPROVAL,
  FILE_CHANGE_APPROVAL,
  MCP_ELICITATION,
  PERMISSIONS_APPROVAL,
  type CodexCommandApprovalParams,
  type CodexElicitationParams,
  type CodexFileChangeApprovalParams,
  type CodexFileChangeItem,
  type CodexMcpToolCallItem,
  type CodexServerRequest,
  type CodexThreadItem,
} from "./codex-protocol.js";

/** The shell tool a command is judged as, as Claude Code names it (spec §6). */
export type ShellTool = "Bash" | "PowerShell";

/**
 * A call the Office rules refused, for the session to report as `tool-refused` by the Office
 * rules, with an error result, and to tell the model why, as a decline carries no reason.
 */
export interface CodexRefusal {
  /** The item the call is, when the app-server named one. */
  readonly callId: string | undefined;
  /** As the port reports it: `Bash`, `Edit`, an Office tool's own name, `mcp__<server>__<tool>`. */
  readonly tool: string;
  readonly input: unknown;
  /** The rules' words. */
  readonly reason: string;
}

/** The answer to one of the app-server's requests, and the refusal it carries when it declines. */
export interface CodexApprovalAnswer {
  readonly result: unknown;
  readonly refusal?: CodexRefusal;
}

export interface CodexApprovalParts {
  /** The session's decision on a call, as Claude Code names the tool: `toolDecision` on its rules. */
  readonly decide: ToolDecider;
  /** The folder the session works in, where its commands run unless a request names another. */
  readonly folder: string;
  readonly paths: Pick<PathRules, "resolve">;
  /** The shell a command line Codex didn't wrap in a known shell is judged in. */
  readonly defaultShell: ShellTool;
  /**
   * Whether a command may run outside Codex's sandbox when the rules allow it: only a session
   * reaching the workstation (spec §6); every other keeps its commands in the worktree.
   */
  readonly outsideSandbox: boolean;
}

/** What a decline says when a command asks to run outside the sandbox. */
export const OUTSIDE_SANDBOX_REFUSAL =
  "Refused by the Office rules: commands in this session run in its sandbox, which writes only in its folder and has no network; running one outside the sandbox isn't allowed.";

/** What a decline says when a command's request doesn't say what it runs. */
export const UNSEEN_COMMAND_REFUSAL =
  "Refused by The Office: it could not judge this command, as the request didn't say what it runs.";

/** What a decline says when a file change asks to write anywhere under a folder from now on. */
export const GRANT_ROOT_REFUSAL =
  "Refused by the Office rules: each file change is judged by itself; writing anywhere under a folder for the rest of the session isn't allowed.";

const ACCEPT = { decision: "accept" } as const;
const DECLINE = { decision: "decline" } as const;

/**
 * Answers the app-server's approval requests from the Office rules (spec §5.4 Defaults, the
 * Codex engine; spec §6), as the hook does on the Claude Code engines: a command as a call of
 * the shell it runs in, a file change as an Edit or Write of each path it touches, an Office or
 * MCP tool's call by its name and arguments. A refusal is a decline, never an approval for the
 * rest of the session. Keeps the items that started, as a file change's request names its item
 * and only the item holds its paths.
 */
export class CodexApprovals {
  private readonly items = new Map<string, CodexFileChangeItem | CodexMcpToolCallItem>();

  constructor(private readonly parts: CodexApprovalParts) {}

  /** Keeps an item that started, until it completes; give it every `item/started`. */
  itemStarted(item: CodexThreadItem): void {
    if (item.type === "fileChange" || item.type === "mcpToolCall") this.items.set(item.id, item);
  }

  /** Forgets an item that completed; give it every `item/completed`. */
  itemCompleted(item: CodexThreadItem): void {
    this.items.delete(item.id);
  }

  async answer(request: CodexServerRequest): Promise<CodexApprovalAnswer> {
    switch (request.method) {
      case COMMAND_APPROVAL:
        return this.command(request.params);
      case FILE_CHANGE_APPROVAL:
        return this.fileChange(request.params);
      case MCP_ELICITATION:
        return this.elicitation(request.params);
      case PERMISSIONS_APPROVAL:
        return {
          // Grants nothing beyond the sandbox, for this turn only.
          result: { permissions: {}, scope: "turn" },
          refusal: {
            callId: request.params.itemId,
            tool: "request_permissions",
            input: request.params.permissions,
            reason: OUTSIDE_SANDBOX_REFUSAL,
          },
        };
    }
  }

  private async command(params: CodexCommandApprovalParams): Promise<CodexApprovalAnswer> {
    const { tool, input } = judgedCommand(params, this.parts);
    const refused = (reason: string): CodexApprovalAnswer => ({
      result: DECLINE,
      refusal: { callId: params.itemId, tool, input, reason },
    });
    // An empty line would pass the rules, as it names nothing they refuse.
    if ((params.command ?? "").trim() === "") return refused(UNSEEN_COMMAND_REFUSAL);
    if (asksOutsideSandbox(params) && !this.parts.outsideSandbox) {
      return refused(OUTSIDE_SANDBOX_REFUSAL);
    }
    const decision = await this.parts.decide(tool, input);
    return decision.allowed ? { result: ACCEPT } : refused(decision.reason);
  }

  private async fileChange(params: CodexFileChangeApprovalParams): Promise<CodexApprovalAnswer> {
    const item = this.items.get(params.itemId);
    const refused = (tool: string, input: unknown, reason: string): CodexApprovalAnswer => ({
      result: DECLINE,
      refusal: { callId: params.itemId, tool, input, reason },
    });
    if (params.grantRoot !== undefined && params.grantRoot !== null) {
      return refused("Write", { file_path: params.grantRoot }, GRANT_ROOT_REFUSAL);
    }
    if (item?.type !== "fileChange") {
      return refused(
        "Edit",
        {},
        "Refused by The Office: it could not judge this file change, as it didn't see what the change touches.",
      );
    }
    for (const { tool, input } of item.changes.flatMap(fileCalls)) {
      const decision = await this.parts.decide(tool, input);
      if (!decision.allowed) return refused(tool, input, decision.reason);
    }
    return { result: ACCEPT };
  }

  private async elicitation(params: CodexElicitationParams): Promise<CodexApprovalAnswer> {
    const call = toolCallOf(params);
    if (call === undefined) {
      // Only an MCP tool call's approval comes as one: the session's servers ask the user nothing.
      return { result: elicitationAnswer("decline") };
    }
    // An Office tool as `mcp__office__<tool>`, allowed by rule; a server's by its setting.
    const engineName = mcpToolName(params.serverName, call.tool);
    const decision = await this.parts.decide(engineName, call.input);
    if (decision.allowed) return { result: elicitationAnswer("accept") };
    return {
      result: elicitationAnswer("decline"),
      refusal: {
        callId: this.runningCall(params.serverName, call.tool),
        tool: portToolName(engineName),
        input: call.input,
        reason: decision.reason,
      },
    };
  }

  /** The id of the call the approval is for: the latest of that tool's calls still running. */
  private runningCall(server: string, tool: string): string | undefined {
    return [...this.items.values()].findLast(
      (item) => item.type === "mcpToolCall" && item.server === server && item.tool === tool,
    )?.id;
  }
}

/** The shell tool Codex's commands run in on this system: PowerShell where Agents have it. */
export function codexShellTool(agentShells: readonly { readonly shell: AgentShell }[]): ShellTool {
  return agentShells.some(({ shell }) => shell === "powershell") ? "PowerShell" : "Bash";
}

/**
 * A command's request as a shell tool's call: Codex wraps the model's command line in the shell
 * that runs it (`/bin/bash -lc '<command>'`), which the rules would judge as running a shell, so
 * the line inside is judged as that shell's own; one that runs elsewhere than the session's
 * folder moves there first, so the rules read its paths from there. Kind `writeStdin` (input to
 * a command running) is judged the same way, by what it names as its command.
 */
function judgedCommand(
  { command, cwd }: CodexCommandApprovalParams,
  { folder, paths, defaultShell }: CodexApprovalParts,
): { readonly tool: ShellTool; readonly input: { readonly command: string } } {
  const { tool, script } = unwrappedCommand(command ?? "", defaultShell);
  const elsewhere =
    cwd !== undefined && cwd !== null && paths.resolve(folder, cwd) !== paths.resolve(folder, ".");
  if (!elsewhere) return { tool, input: { command: script } };
  return {
    tool,
    input: {
      command:
        tool === "Bash"
          ? `cd ${bashQuoted(cwd)} && ${script}`
          : `cd ${powerShellQuoted(cwd)}; ${script}`,
    },
  };
}

const POSIX_SHELLS: ReadonlySet<string> = new Set(["bash", "sh", "zsh", "dash"]);
const POWERSHELLS: ReadonlySet<string> = new Set(["powershell", "pwsh"]);

/**
 * The command line Codex's shell wrapper runs, and the shell, when the whole line is one such
 * wrapper: a POSIX shell's `-c`/`-lc` script, or PowerShell's `-Command`. Anything else is judged
 * whole, in the system's shell.
 */
export function unwrappedCommand(
  command: string,
  defaultShell: ShellTool,
): { readonly tool: ShellTool; readonly script: string } {
  return (
    posixScript(command) ?? powerShellScript(command) ?? { tool: defaultShell, script: command }
  );
}

function posixScript(command: string): { tool: ShellTool; script: string } | undefined {
  const commands = readCommands(command, "bash");
  const [shell, option, script, ...rest] = commands?.[0]?.words ?? [];
  if (
    commands === undefined ||
    shell === undefined ||
    script === undefined ||
    rest.length > 0 ||
    !POSIX_SHELLS.has(programName(shell)) ||
    !/^-l?c$/.test(option ?? "")
  ) {
    return undefined;
  }
  return onlyCommand(commands, script, "bash") ? { tool: "Bash", script } : undefined;
}

function powerShellScript(command: string): { tool: ShellTool; script: string } | undefined {
  const commands = readCommands(command, "powershell");
  const [shell, ...parameters] = commands?.[0]?.words ?? [];
  if (commands === undefined || shell === undefined || !POWERSHELLS.has(programName(shell))) {
    return undefined;
  }
  const option = parameters.findIndex((word) => /^-c(o(m(m(a(n(d)?)?)?)?)?)?$/i.test(word));
  if (option === -1 || parameters.slice(0, option).some((word) => !word.startsWith("-"))) {
    return undefined;
  }
  const script = parameters.slice(option + 1).join(" ");
  return onlyCommand(commands, script, "powershell") ? { tool: "PowerShell", script } : undefined;
}

/**
 * Whether the wrapper is the whole command line: every command read in it, but the wrapper, is
 * one of its script's, so nothing runs beside the wrapper unjudged as its own.
 */
function onlyCommand(
  commands: readonly SimpleCommand[],
  script: string,
  dialect: ShellDialect,
): boolean {
  const inner = readCommands(script, dialect);
  return (
    inner !== undefined &&
    commands[0]?.redirects.length === 0 &&
    inner.length + 1 === commands.length
  );
}

function readCommands(command: string, dialect: ShellDialect): SimpleCommand[] | undefined {
  try {
    return simpleCommands(command, dialect);
  } catch {
    return undefined;
  }
}

/** Whether a command asks to run outside the sandbox: with a reason, more permissions or network. */
function asksOutsideSandbox({
  reason,
  additionalPermissions,
  networkApprovalContext,
}: CodexCommandApprovalParams): boolean {
  return (
    (reason !== undefined && reason !== null && reason !== "") ||
    (additionalPermissions !== undefined && additionalPermissions !== null) ||
    (networkApprovalContext !== undefined && networkApprovalContext !== null)
  );
}

/**
 * The calls a change of a file is judged as: a new file a Write, a change an Edit, a removal an
 * Edit of the file, a move an Edit of the file and a Write of where it goes.
 */
function fileCalls({ path, kind }: CodexFileChangeItem["changes"][number]): {
  tool: "Edit" | "Write";
  input: { file_path: string };
}[] {
  switch (kind.type) {
    case "add":
      return [{ tool: "Write", input: { file_path: path } }];
    case "delete":
      return [{ tool: "Edit", input: { file_path: path } }];
    case "update":
      return [
        { tool: "Edit", input: { file_path: path } },
        ...(typeof kind.move_path === "string"
          ? [{ tool: "Write" as const, input: { file_path: kind.move_path } }]
          : []),
      ];
  }
}

/** The MCP tool call an elicitation asks to approve (`_meta`), or undefined for any other. */
function toolCallOf(
  params: CodexElicitationParams,
): { readonly tool: string; readonly input: unknown } | undefined {
  const meta = params["_meta"];
  if (typeof meta !== "object" || meta === null) return undefined;
  const {
    codex_approval_kind: kind,
    tool_name: toolName,
    tool_params: input,
  } = meta as Record<string, unknown>;
  if (kind !== "mcp_tool_call" || typeof toolName !== "string" || toolName === "") return undefined;
  // A tool's name as the server lists it; one prefixed as the model calls it is read the same.
  const prefix = `mcp__${params.serverName}__`;
  const tool = toolName.startsWith(prefix) ? toolName.slice(prefix.length) : toolName;
  return { tool, input: input ?? {} };
}

function elicitationAnswer(action: "accept" | "decline"): unknown {
  return { action, content: null, _meta: null };
}

function bashQuoted(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function powerShellQuoted(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}
