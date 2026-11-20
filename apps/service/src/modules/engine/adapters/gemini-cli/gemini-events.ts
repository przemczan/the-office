import { NO_TOKENS, type SessionEvent, type TokenUsage } from "../../ports/session-events.js";
import { displayedCall, type GeminiToolSession } from "./gemini-tool-actions.js";

/** The stats of a turn's `result`, as the pinned CLI's `convertToStreamStats` gives them. */
export interface GeminiStreamStats {
  /** Every request's prompt tokens of the turn, the cached ones included. */
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cached?: number;
}

/** One line of `--output-format stream-json` (the pinned CLI's `JsonStreamEventType`). */
export type GeminiStreamEvent =
  | { readonly type: "init"; readonly session_id?: string; readonly model?: string }
  | {
      readonly type: "message";
      readonly role?: string;
      readonly content?: string;
      readonly delta?: boolean;
    }
  | {
      readonly type: "tool_use";
      readonly tool_name?: string;
      readonly tool_id?: string;
      readonly parameters?: unknown;
    }
  | {
      readonly type: "tool_result";
      readonly tool_id?: string;
      readonly status?: string;
      readonly output?: string;
      readonly error?: { readonly type?: string; readonly message?: string };
    }
  | { readonly type: "error"; readonly severity?: string; readonly message?: string }
  | {
      readonly type: "result";
      readonly status?: string;
      readonly error?: { readonly type?: string; readonly message?: string };
      readonly stats?: GeminiStreamStats;
    };

const EVENT_TYPES: ReadonlySet<string> = new Set([
  "init",
  "message",
  "tool_use",
  "tool_result",
  "error",
  "result",
]);

/** A line of the CLI's output as an event, or undefined for anything else it printed. */
export function parsedStreamLine(line: string): GeminiStreamEvent | undefined {
  if (line.trim() === "") return undefined;
  try {
    const parsed = JSON.parse(line) as { readonly type?: unknown };
    return typeof parsed.type === "string" && EVENT_TYPES.has(parsed.type)
      ? (parsed as GeminiStreamEvent)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A turn's tokens from its `result`'s stats: the prompt tokens hold the cached ones, which count
 * apart as cache reads; the CLI reports no cache writes.
 */
export function turnTokens(stats: GeminiStreamStats | undefined): TokenUsage {
  if (stats === undefined) return NO_TOKENS;
  const cacheRead = stats.cached ?? 0;
  return {
    input: Math.max((stats.input_tokens ?? 0) - cacheRead, 0),
    output: stats.output_tokens ?? 0,
    cacheRead,
    cacheCreation: 0,
  };
}

/** A call the hook refused, kept until the call's result shows which one it was. */
interface HookRefusal {
  readonly toolName: string;
  readonly input: string;
  readonly reason: string;
}

/**
 * The calls the session's hook refused, as it refused them: the hook's input names no call id, so a
 * refusal is matched to the failed result of the call with the same tool and input.
 */
export class HookRefusals {
  private readonly waiting: HookRefusal[] = [];

  refused(toolName: string, input: unknown, reason: string): void {
    this.waiting.push({ toolName, input: JSON.stringify(input ?? {}), reason });
  }

  /** The reason the hook refused this call with, taken once; undefined when it didn't refuse it. */
  take(toolName: string, input: unknown): string | undefined {
    const key = JSON.stringify(input ?? {});
    const index = this.waiting.findIndex(
      (refusal) => refusal.toolName === toolName && refusal.input === key,
    );
    if (index === -1) return undefined;
    return this.waiting.splice(index, 1)[0]?.reason;
  }
}

/** How a turn's process said it ended, read from its output. */
export interface TurnEnding {
  /** Whether a `result` said the turn succeeded. */
  readonly succeeded: boolean;
  /** Whether the output held a `result` at all. */
  readonly resultGiven: boolean;
  readonly usage: TokenUsage;
  /** What the CLI said went wrong, in its words. */
  readonly errors: readonly string[];
}

/**
 * Maps one turn's stream-json output to the port's events (spec §5.4.7): the model's text, joined
 * from its deltas into one text event before each tool call and at the end, as a Thread logs each
 * text event as one message; each tool call as the Office rules judge it (`displayedCall`); a call
 * the hook refused as `tool-refused` before its result; the turn's tokens and errors for its end.
 */
export class GeminiTurnEvents {
  private text = "";
  private readonly calls = new Map<
    string,
    { readonly toolName: string; readonly input: unknown }
  >();
  private readonly errors: string[] = [];
  private result: Extract<GeminiStreamEvent, { type: "result" }> | undefined;

  constructor(
    private readonly session: GeminiToolSession,
    private readonly refusals: HookRefusals,
  ) {}

  of(event: GeminiStreamEvent): SessionEvent[] {
    switch (event.type) {
      case "message":
        if (event.role === "assistant") this.text += event.content ?? "";
        return [];
      case "tool_use":
        return [...this.textSoFar(), this.toolCall(event)];
      case "tool_result":
        return this.toolResult(event);
      case "error":
        if (event.severity !== "warning" && event.message) this.errors.push(event.message);
        return [];
      case "result":
        this.result = event;
        if (event.error?.message) this.errors.push(event.error.message);
        return this.textSoFar();
      case "init":
        return [];
    }
  }

  /** What is left of the model's text once the output ends without a `result`. */
  rest(): SessionEvent[] {
    return this.textSoFar();
  }

  get ending(): TurnEnding {
    return {
      succeeded: this.result?.status === "success",
      resultGiven: this.result !== undefined,
      usage: turnTokens(this.result?.stats),
      errors: [...this.errors],
    };
  }

  private textSoFar(): SessionEvent[] {
    if (this.text.trim() === "") {
      this.text = "";
      return [];
    }
    const text = this.text;
    this.text = "";
    return [{ kind: "text", text, withinToolCall: undefined }];
  }

  private toolCall(event: Extract<GeminiStreamEvent, { type: "tool_use" }>): SessionEvent {
    const callId = event.tool_id ?? "";
    const toolName = event.tool_name ?? "";
    const input = event.parameters ?? {};
    this.calls.set(callId, { toolName, input });
    const { tool, officeTool } = displayedCall({ toolName, input }, this.session);
    return { kind: "tool-call", callId, tool, officeTool, input, withinToolCall: undefined };
  }

  private toolResult(event: Extract<GeminiStreamEvent, { type: "tool_result" }>): SessionEvent[] {
    const callId = event.tool_id ?? "";
    const isError = event.status !== "success";
    const text = isError ? (event.error?.message ?? event.output ?? "") : (event.output ?? "");
    const result: SessionEvent = {
      kind: "tool-result",
      callId,
      text,
      isError,
      withinToolCall: undefined,
    };
    const call = this.calls.get(callId);
    const reason = isError && call ? this.refusals.take(call.toolName, call.input) : undefined;
    if (call === undefined || reason === undefined) return [result];
    const { tool } = displayedCall({ toolName: call.toolName, input: call.input }, this.session);
    return [{ kind: "tool-refused", callId, tool, reason, refusedBy: "office-rules" }, result];
  }
}
