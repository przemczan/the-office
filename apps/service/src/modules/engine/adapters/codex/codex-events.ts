import { Ajv2020 } from "ajv/dist/2020.js";
import { SKILL_TOOL } from "../../domain/skill-calls.js";
import {
  UNKNOWN_RESET_RETRY_MS,
  type RateLimitEvent,
  type TextEvent,
  type TokenUsage,
  type ToolCallEvent,
  type ToolRefusedEvent,
  type ToolResultEvent,
  type TurnOutcome,
  type UsageWindowName,
  type UsedUpWindow,
} from "../../ports/session-events.js";
import type { JsonSchema } from "../../ports/session-options.js";
import { mcpToolName, OFFICE_TOOL_SERVER } from "../office-rules/office-tool-names.js";
import { unwrappedCommand, type CodexRefusal, type ShellTool } from "./codex-approvals.js";
import type {
  CodexCommandExecutionItem,
  CodexFileUpdateChange,
  CodexMcpToolCallItem,
  CodexRateLimitSnapshot,
  CodexRateLimitWindow,
  CodexThreadItem,
  CodexTokenUsage,
  CodexTurn,
} from "./codex-protocol.js";
import {
  codexResetOf,
  codexWindowsOf,
  FIVE_HOURS_MINUTES,
  SEVEN_DAYS_MINUTES,
  usedUp,
} from "./codex-usage-windows.js";

/*
 * What a Codex session reports, made of the app-server's items and notifications in the port's
 * terms, under Claude Code's tool names, so Threads, the Office rules' words and Skills read a
 * Codex session as any other (spec §5.4 Defaults, the Codex engine).
 */

/** A tool call as the port reports it, made of one of Codex's items. */
export interface CodexToolCall {
  readonly callId: string;
  readonly tool: string;
  readonly officeTool: boolean;
  readonly input: unknown;
}

/**
 * The calls an item is: a command one call of the system's shell with the command line Codex's
 * wrapper runs, a file change one Write (a new file) or Edit (any other change) per path, an MCP
 * tool's call `mcp__<server>__<tool>`, the `office` server's by the Office tool's own name and its
 * `Skill` as Claude Code's own. Any other item is no call.
 */
export function itemCalls(item: CodexThreadItem, shellTool: ShellTool): CodexToolCall[] {
  switch (item.type) {
    case "commandExecution": {
      const { tool, script } = unwrappedCommand(item.command, shellTool);
      return [{ callId: item.id, tool, officeTool: false, input: { command: script } }];
    }
    case "fileChange":
      return item.changes.map((change, index) => ({
        callId: fileChangeCallId(item.id, index),
        tool: change.kind.type === "add" ? "Write" : "Edit",
        officeTool: false,
        input: { file_path: change.path, diff: change.diff },
      }));
    case "mcpToolCall":
      return [{ callId: item.id, ...mcpCall(item), input: item.arguments ?? {} }];
    default:
      return [];
  }
}

/** One call per path: the first by the item's id, so a refusal naming the item names it. */
export function fileChangeCallId(itemId: string, index: number): string {
  return index === 0 ? itemId : `${itemId}#${index + 1}`;
}

function mcpCall({ server, tool }: CodexMcpToolCallItem): Omit<CodexToolCall, "callId" | "input"> {
  if (server !== OFFICE_TOOL_SERVER) {
    return { tool: mcpToolName(server, tool), officeTool: false };
  }
  // Skill is Claude Code's own tool, which Skills counts by that name.
  return tool === SKILL_TOOL ? { tool, officeTool: false } : { tool, officeTool: true };
}

export function toolCallEvent({ callId, tool, officeTool, input }: CodexToolCall): ToolCallEvent {
  return { kind: "tool-call", callId, tool, officeTool, input, withinToolCall: undefined };
}

/** What a completed item reports: the Agent's text, or each of its calls' results. */
export function completedItemEvents(item: CodexThreadItem): (TextEvent | ToolResultEvent)[] {
  switch (item.type) {
    case "agentMessage":
      return item.text.trim() === ""
        ? []
        : [{ kind: "text", text: item.text, withinToolCall: undefined }];
    case "commandExecution":
      return [toolResult(item.id, commandOutput(item), commandFailed(item))];
    case "fileChange":
      return item.changes.map((change, index) =>
        toolResult(
          fileChangeCallId(item.id, index),
          fileChangeOutput(change, item.status),
          item.status !== "completed",
        ),
      );
    case "mcpToolCall":
      return [toolResult(item.id, mcpOutput(item), mcpFailed(item))];
    default:
      return [];
  }
}

export function toolResult(callId: string, text: string, isError: boolean): ToolResultEvent {
  return { kind: "tool-result", callId, text, isError, withinToolCall: undefined };
}

function commandFailed({ status, exitCode }: CodexCommandExecutionItem): boolean {
  return status === "failed" || status === "declined" || (exitCode ?? 0) !== 0;
}

/** As Claude Code's shell answers: the output, after the exit code when it failed. */
function commandOutput(item: CodexCommandExecutionItem): string {
  const output = item.aggregatedOutput ?? "";
  if (item.status === "declined") return output === "" ? "The command was declined." : output;
  if (!commandFailed(item) || item.exitCode === undefined || item.exitCode === null) return output;
  return output === "" ? `Exit code ${item.exitCode}` : `Exit code ${item.exitCode}\n${output}`;
}

function fileChangeOutput(
  { path, kind }: CodexFileUpdateChange,
  status: "inProgress" | "completed" | "failed" | "declined",
): string {
  switch (status) {
    case "completed":
      return kind.type === "add"
        ? `The file ${path} was written.`
        : kind.type === "delete"
          ? `The file ${path} was removed.`
          : `The file ${path} was changed.`;
    case "declined":
      return `The change of ${path} was declined.`;
    default:
      return `The change of ${path} failed.`;
  }
}

function mcpFailed({ status, result }: CodexMcpToolCallItem): boolean {
  return (
    status === "failed" || (result as { isError?: unknown } | null | undefined)?.isError === true
  );
}

/** The text parts of the tool's answer; a picture or another part by its kind. */
function mcpOutput({ result, error }: CodexMcpToolCallItem): string {
  if (error !== undefined && error !== null) return error.message;
  return (result?.content ?? [])
    .map((part) => {
      const { type, text } = (part ?? {}) as { type?: unknown; text?: unknown };
      return type === "text" && typeof text === "string" ? text : `[${String(type)}]`;
    })
    .join("\n");
}

/**
 * A call the Office rules refused, as the hook's refusal is reported on the Claude Code engines:
 * the refusal, then the error result the Agent reads, in the rules' words.
 */
export function refusalEvents(
  callId: string,
  { tool, reason }: CodexRefusal,
): [ToolRefusedEvent, ToolResultEvent] {
  return [
    { kind: "tool-refused", callId, tool, reason, refusedBy: "office-rules" },
    toolResult(callId, reason, true),
  ];
}

/** The note a refusal steers into the turn, as a decline tells the model no reason. */
export function refusalNote({ tool, reason }: CodexRefusal): string {
  return `The Office rules refused ${tool}: ${reason}`;
}

// ---- Tokens ----

/**
 * Codex's counts in the port's terms: its input includes the cached input, which is a cache read
 * here, and its output includes the reasoning (spec §5.4 Defaults, Cost).
 */
export function codexTokens(breakdown: CodexTokenUsage): TokenUsage {
  return {
    input: Math.max(0, breakdown.inputTokens - breakdown.cachedInputTokens),
    output: breakdown.outputTokens,
    cacheRead: breakdown.cachedInputTokens,
    cacheCreation: 0,
  };
}

/** What a thread's total grew by. */
export function tokensSince(before: TokenUsage, now: TokenUsage): TokenUsage {
  return {
    input: Math.max(0, now.input - before.input),
    output: Math.max(0, now.output - before.output),
    cacheRead: Math.max(0, now.cacheRead - before.cacheRead),
    cacheCreation: Math.max(0, now.cacheCreation - before.cacheCreation),
  };
}

/** What the thread held before the model call an update reports. */
export function tokensBefore(total: CodexTokenUsage, last: CodexTokenUsage): TokenUsage {
  return tokensSince(codexTokens(last), codexTokens(total));
}

// ---- Usage windows ----

/** A sparse update read over the last reading: what it leaves out keeps its last value. */
export function mergedRateLimits(
  earlier: CodexRateLimitSnapshot | undefined,
  update: CodexRateLimitSnapshot,
): CodexRateLimitSnapshot {
  if (earlier === undefined) return update;
  const kept = Object.fromEntries(
    Object.entries(update).filter(([, value]) => value !== undefined && value !== null),
  );
  return { ...earlier, ...kept };
}

/**
 * The signal to read the windows, naming the fullest one: `rejected` once a window is used up or the
 * account reached a limit, else `allowed`, as Codex reports no warning level of its own.
 */
export function rateLimitEvent(snapshot: CodexRateLimitSnapshot): RateLimitEvent {
  const window = fullestWindow(snapshot);
  const rejected = isSet(snapshot.rateLimitReachedType) || (window !== undefined && usedUp(window));
  return {
    kind: "rate-limit",
    status: rejected ? "rejected" : "allowed",
    window: window === undefined ? undefined : windowName(window),
    resetsAt: codexResetOf(window),
  };
}

/**
 * The window a turn refused for a used-up window found used up, by the latest reading: the fullest
 * at 100% or more, with its reset; with none, `unknown` and a wait of `UNKNOWN_RESET_RETRY_MS`, so
 * the reset comes from the next reading.
 */
export function usedUpWindow(
  snapshot: CodexRateLimitSnapshot | undefined,
  now: Date,
): UsedUpWindow {
  const fullest = snapshot === undefined ? undefined : fullestWindow(snapshot);
  const window = fullest !== undefined && usedUp(fullest) ? fullest : undefined;
  const resetsAt = codexResetOf(window);
  return {
    window: window === undefined ? "unknown" : windowName(window),
    resetsAt: resetsAt ?? new Date(now.getTime() + UNKNOWN_RESET_RETRY_MS),
    resetGiven: resetsAt !== undefined,
  };
}

function fullestWindow(snapshot: CodexRateLimitSnapshot): CodexRateLimitWindow | undefined {
  return codexWindowsOf(snapshot).toSorted((one, other) => other.usedPercent - one.usedPercent)[0];
}

/** The 5-hour and 7-day windows by the port's names; a window of another length is `unknown`. */
function windowName(window: CodexRateLimitWindow): UsageWindowName {
  if (window.windowDurationMins === FIVE_HOURS_MINUTES) return "five-hour";
  if (window.windowDurationMins === SEVEN_DAYS_MINUTES) return "seven-day";
  return "unknown";
}

function isSet(value: string | null | undefined): boolean {
  return value !== undefined && value !== null && value !== "";
}

// ---- A turn's end ----

export interface TurnEnding {
  readonly outcome: TurnOutcome;
  readonly errors: readonly string[];
  readonly usedUpWindow?: UsedUpWindow;
}

/** Codex's name for a turn refused because a usage window is used up. */
const USAGE_LIMIT_EXCEEDED = "usageLimitExceeded";

/**
 * How a turn ended, as `turn/completed` says: a failed turn whose error names a used-up usage
 * window is one (spec §5.4 Defaults, Usage windows), every other failure in Codex's words.
 */
export function turnEnding(
  { status, error }: CodexTurn,
  rateLimits: CodexRateLimitSnapshot | undefined,
  now: Date,
): TurnEnding {
  switch (status) {
    case "completed":
      return { outcome: "completed", errors: [] };
    case "interrupted":
      return { outcome: "interrupted", errors: [] };
    case "failed": {
      if (error?.codexErrorInfo === USAGE_LIMIT_EXCEEDED) {
        return {
          outcome: "usage-window-used-up",
          errors: [error.message],
          usedUpWindow: usedUpWindow(rateLimits, now),
        };
      }
      const words =
        error === undefined || error === null
          ? "The turn failed without saying why."
          : isSet(error.additionalDetails)
            ? `${error.message} ${error.additionalDetails ?? ""}`.trim()
            : error.message;
      return { outcome: "failed", errors: [words] };
    }
    case "inProgress":
      return { outcome: "failed", errors: ["The turn ended unfinished."] };
  }
}

// ---- A turn's output ----

export type TurnOutput =
  | { readonly fits: true; readonly output: unknown }
  | { readonly fits: false; readonly problem: string };

/**
 * Reads a turn's answer under the session's output schema: its last agent message, as JSON that
 * fits the schema (spec §5.4 Defaults, Stage answers held to the schema).
 */
export function outputReader(schema: JsonSchema): (answer: string | undefined) => TurnOutput {
  // Not strict: a schema may carry keywords Ajv doesn't know, such as a `description` placement.
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);
  return (answer) => {
    if (answer === undefined) {
      return { fits: false, problem: "The turn ended without an answer in its output schema." };
    }
    let output: unknown;
    try {
      output = JSON.parse(answer);
    } catch {
      return { fits: false, problem: "The turn's answer isn't JSON, as its output schema asks." };
    }
    if (validate(output)) return { fits: true, output };
    const problems = (validate.errors ?? []).map(
      (error) => `${error.instancePath || "the answer"} ${error.message ?? "is invalid"}`,
    );
    return {
      fits: false,
      problem: `The turn's answer doesn't fit its output schema: ${problems.join("; ")}`,
    };
  };
}
