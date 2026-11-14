import type {
  SDKAssistantMessage,
  SDKControlGetUsageResponse,
  SDKMessage,
  SDKRateLimitEvent,
  SDKResultMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ReadingSource, UsageWindow, UsageWindows } from "../../domain/usage-windows.js";
import {
  UNKNOWN_RESET_RETRY_MS,
  type KnownUsageWindowName,
  type RateLimitEvent,
  type RateLimitStatus,
  type SessionEvent,
  type TokenUsage,
  type TurnEndedEvent,
  type TurnOutcome,
  type UsageWindowName,
} from "../../ports/session-events.js";
import { OFFICE_TOOL_PREFIX, portToolName } from "../office-rules/office-tool-names.js";

/** How the engine ends a turn that `interrupt()` stopped, by what was running then. */
const INTERRUPTED_REASONS: ReadonlySet<string> = new Set(["aborted_streaming", "aborted_tools"]);

const RATE_LIMIT_STATUSES: Readonly<
  Record<SDKRateLimitEvent["rate_limit_info"]["status"], RateLimitStatus>
> = {
  allowed: "allowed",
  allowed_warning: "warning",
  rejected: "rejected",
};

type EngineWindowName = NonNullable<SDKRateLimitEvent["rate_limit_info"]["rateLimitType"]>;

const USAGE_WINDOW_NAMES: Readonly<Record<EngineWindowName, KnownUsageWindowName>> = {
  five_hour: "five-hour",
  seven_day: "seven-day",
  seven_day_opus: "seven-day-opus",
  seven_day_sonnet: "seven-day-sonnet",
  seven_day_overage_included: "seven-day-overage-included",
  overage: "overage",
};

/**
 * The port's events for one message of the engine's stream. Messages the Office has no use for,
 * and kinds a newer engine adds, map to none.
 */
export function sessionEvents(message: SDKMessage): SessionEvent[] {
  switch (message.type) {
    case "assistant":
      return assistantEvents(message);
    case "user":
      return "isReplay" in message ? [] : toolResults(message);
    case "result":
      return [turnEnded(message)];
    case "rate_limit_event":
      return [rateLimit(message)];
    default:
      return [];
  }
}

/**
 * The running turn's tokens, from the Agent's messages as they stream. The engine delivers a
 * message as frames, one per content block, sharing the message's id and repeating its usage, so
 * each id counts once, at its latest frame's usage. A subagent's messages are left out, as the
 * turn's own usage leaves them out, so the count doesn't drop when that usage takes over at the
 * turn's end. A frame's output tokens are those known as its message began; the turn's usage
 * brings the rest (docs/engine-check.md, engine.turn-usage). Call `settled` on the turn's end
 * before passing its result to `eventsOf`, which forgets the turn.
 */
export class TurnTokens {
  private readonly byMessage = new Map<string, TokenUsage>();

  /**
   * A turn-tokens event when the message changed the running count, after a context-read event
   * when it is the Agent's next answer: its input is the context the model read for it.
   */
  eventsOf(message: SDKMessage): SessionEvent[] {
    if (message.type === "result") {
      this.byMessage.clear();
      return [];
    }
    if (message.type !== "assistant" || message.parent_tool_use_id !== null) return [];
    const { id, usage } = message.message;
    const counted = tokenUsageOf(usage);
    const before = this.byMessage.get(id);
    if (before && sameUsage(before, counted)) return [];
    this.byMessage.set(id, counted);
    const tokens: SessionEvent = { kind: "turn-tokens", soFar: this.soFar() };
    if (before) return [tokens];
    const { input, cacheRead, cacheCreation } = counted;
    return [{ kind: "context-read", tokens: input + cacheRead + cacheCreation }, tokens];
  }

  /**
   * The turn's end with its usage at least what its messages streamed, part by part. A turn
   * interrupted while a message streams reports usage without that message, though its input was
   * spent; any other turn's usage already counts each message, and more output.
   */
  settled(ended: TurnEndedEvent): TurnEndedEvent {
    const streamed = this.soFar();
    const { usage } = ended;
    return {
      ...ended,
      usage: {
        input: Math.max(usage.input, streamed.input),
        output: Math.max(usage.output, streamed.output),
        cacheRead: Math.max(usage.cacheRead, streamed.cacheRead),
        cacheCreation: Math.max(usage.cacheCreation, streamed.cacheCreation),
      },
    };
  }

  private soFar(): TokenUsage {
    let total: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
    for (const usage of this.byMessage.values()) {
      total = {
        input: total.input + usage.input,
        output: total.output + usage.output,
        cacheRead: total.cacheRead + usage.cacheRead,
        cacheCreation: total.cacheCreation + usage.cacheCreation,
      };
    }
    return total;
  }
}

function tokenUsageOf(usage: SDKAssistantMessage["message"]["usage"]): TokenUsage {
  return {
    input: usage.input_tokens,
    output: usage.output_tokens,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheCreation: usage.cache_creation_input_tokens ?? 0,
  };
}

function sameUsage(one: TokenUsage, other: TokenUsage): boolean {
  return (
    one.input === other.input &&
    one.output === other.output &&
    one.cacheRead === other.cacheRead &&
    one.cacheCreation === other.cacheCreation
  );
}

function assistantEvents({
  message,
  parent_tool_use_id,
  error,
}: SDKAssistantMessage): SessionEvent[] {
  // The engine's own message for a refused turn, not the Agent's words: its text is the turn's error.
  if (error === "rate_limit") return [];
  const withinToolCall = parent_tool_use_id ?? undefined;
  return message.content.flatMap((block): SessionEvent[] => {
    switch (block.type) {
      case "text":
        return [{ kind: "text", text: block.text, withinToolCall }];
      case "tool_use":
        return [
          {
            kind: "tool-call",
            callId: block.id,
            tool: portToolName(block.name),
            officeTool: block.name.startsWith(OFFICE_TOOL_PREFIX),
            input: block.input,
            withinToolCall,
          },
        ];
      default:
        return [];
    }
  });
}

function toolResults({ message, parent_tool_use_id }: SDKUserMessage): SessionEvent[] {
  if (typeof message.content === "string") return [];
  return message.content.flatMap((block): SessionEvent[] =>
    block.type === "tool_result"
      ? [
          {
            kind: "tool-result",
            callId: block.tool_use_id,
            text: toolResultText(block.content),
            isError: block.is_error ?? false,
            withinToolCall: parent_tool_use_id ?? undefined,
          },
        ]
      : [],
  );
}

/** A tool result's text parts, joined; images and documents have none. */
export function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part: unknown) =>
      typeof part === "object" && part !== null && "text" in part && typeof part.text === "string"
        ? [part.text]
        : [],
    )
    .join("\n");
}

function turnEnded(result: SDKResultMessage): SessionEvent {
  const succeeded = result.subtype === "success" && !result.is_error;
  return {
    kind: "turn-ended",
    outcome: outcomeOf(result, succeeded),
    consumedMessageIds:
      result.user_message_uuids ??
      (result.user_message_uuid === undefined ? [] : [result.user_message_uuid]),
    usage: {
      input: result.usage.input_tokens,
      output: result.usage.output_tokens,
      cacheRead: result.usage.cache_read_input_tokens,
      cacheCreation: result.usage.cache_creation_input_tokens,
    },
    sessionCostUsd: result.total_cost_usd,
    output: result.subtype === "success" && succeeded ? result.structured_output : undefined,
    errors: result.subtype === "success" ? (succeeded ? [] : [result.result]) : result.errors,
  };
}

function outcomeOf(result: SDKResultMessage, succeeded: boolean): TurnOutcome {
  if (succeeded) return "completed";
  return INTERRUPTED_REASONS.has(result.terminal_reason ?? "") ? "interrupted" : "failed";
}

function rateLimit({ rate_limit_info: info }: SDKRateLimitEvent): RateLimitEvent {
  return {
    kind: "rate-limit",
    status: RATE_LIMIT_STATUSES[info.status],
    window: info.rateLimitType === undefined ? undefined : usageWindowName(info.rateLimitType),
    resetsAt: info.resetsAt === undefined ? undefined : new Date(info.resetsAt * 1000),
  };
}

/** A window a newer engine adds keeps its own name, so a refusal for it still pauses. */
function usageWindowName(engineName: string): UsageWindowName {
  return engineName in USAGE_WINDOW_NAMES
    ? USAGE_WINDOW_NAMES[engineName as EngineWindowName]
    : engineName;
}

/**
 * Tells a turn the engine refused for a used-up usage window from a failed one (spec 5.4,
 * docs/engine-check.md engine.usage-window-refusal): the engine reads a 429's rate-limit headers
 * into a `rejected` event and ends the turn with an error, so a turn that fails while the turn's
 * latest event is `rejected` is refused. A turn failing after an `allowed` event (overloaded, a
 * 5xx) stays failed, and so does `error: "rate_limit"` without a rejected event, as the engine
 * uses it for other 429s too. Call `settled` on each turn's end, which forgets the turn.
 */
export class RefusedTurns {
  private latest: RateLimitEvent | undefined;

  constructor(private readonly now: () => Date = () => new Date()) {}

  seen(event: SessionEvent): void {
    if (event.kind === "rate-limit") this.latest = event;
  }

  settled(ended: TurnEndedEvent): TurnEndedEvent {
    const latest = this.latest;
    this.latest = undefined;
    if (ended.outcome !== "failed" || latest?.status !== "rejected") return ended;
    const resetGiven = latest.resetsAt !== undefined;
    return {
      ...ended,
      outcome: "usage-window-used-up",
      usedUpWindow: {
        window: latest.window ?? "unknown",
        resetsAt: latest.resetsAt ?? new Date(this.now().getTime() + UNKNOWN_RESET_RETRY_MS),
        resetGiven,
      },
    };
  }
}

/** The usage query's windows as the port has them; undefined for an account without them. */
export function usageWindows({
  rate_limits_available: available,
  rate_limits: windows,
}: Pick<SDKControlGetUsageResponse, "rate_limits_available" | "rate_limits">):
  UsageWindows | undefined {
  if (!available || windows === null) return undefined;
  return {
    fiveHour: usageWindow(windows.five_hour),
    sevenDay: usageWindow(windows.seven_day),
    source: readingSourceOf(windows),
  };
}

type UsageQueryWindows = NonNullable<SDKControlGetUsageResponse["rate_limits"]>;
type UsageQueryWindow = UsageQueryWindows["five_hour"];

/** A reset the CLI makes from a header's epoch seconds, with `toISOString`: whole seconds. */
const HEADER_RESET = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/;

/**
 * The query isn't typed for its source, so it is told from the answer's shape (seen in the CLI and
 * on a live account, task 37's step 7): the endpoint's own answer carries its `limits`; one the CLI
 * builds from the headers drops them and gives each reset at whole seconds. Anything else, such as
 * the endpoint's answer kept from an earlier session, is undefined.
 */
function readingSourceOf(windows: UsageQueryWindows): ReadingSource | undefined {
  if ("limits" in windows && Array.isArray(windows.limits)) return "usage-endpoint";
  const resets = [windows.five_hour, windows.seven_day].flatMap((window) =>
    window?.resets_at ? [window.resets_at] : [],
  );
  return resets.length > 0 && resets.every((reset) => HEADER_RESET.test(reset))
    ? "rate-limit-headers"
    : undefined;
}

/** A window the query gives without its use or its reset is read as not begun, so unused. */
function usageWindow(window: UsageQueryWindow): UsageWindow {
  const percentUsed = window?.utilization ?? undefined;
  const resetsAt = window?.resets_at ?? undefined;
  if (percentUsed === undefined || resetsAt === undefined) {
    return { percentUsed: 0, resetsAt: undefined };
  }
  return { percentUsed, resetsAt: new Date(resetsAt) };
}
