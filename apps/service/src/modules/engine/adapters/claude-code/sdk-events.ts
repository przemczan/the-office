import type {
  SDKAssistantMessage,
  SDKControlGetUsageResponse,
  SDKMessage,
  SDKRateLimitEvent,
  SDKResultMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { UsageWindow, UsageWindows } from "../../domain/usage-windows.js";
import type {
  RateLimitStatus,
  SessionEvent,
  TokenUsage,
  TurnEndedEvent,
  TurnOutcome,
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

  /** A turn-tokens event when the message changed the running count; none otherwise. */
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
    return [{ kind: "turn-tokens", soFar: this.soFar() }];
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

function assistantEvents({ message, parent_tool_use_id }: SDKAssistantMessage): SessionEvent[] {
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

function toolResults({ message }: SDKUserMessage): SessionEvent[] {
  if (typeof message.content === "string") return [];
  return message.content.flatMap((block): SessionEvent[] =>
    block.type === "tool_result"
      ? [
          {
            kind: "tool-result",
            callId: block.tool_use_id,
            text: textOf(block.content),
            isError: block.is_error ?? false,
          },
        ]
      : [],
  );
}

/** A tool result's text parts, joined; images and documents have none. */
function textOf(content: unknown): string {
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

function rateLimit({ rate_limit_info: info }: SDKRateLimitEvent): SessionEvent {
  return {
    kind: "rate-limit",
    status: RATE_LIMIT_STATUSES[info.status],
    resetsAt: info.resetsAt === undefined ? undefined : new Date(info.resetsAt * 1000),
  };
}

/** The usage query's windows as the port has them; undefined for an account without them. */
export function usageWindows({
  rate_limits_available: available,
  rate_limits: windows,
}: Pick<SDKControlGetUsageResponse, "rate_limits_available" | "rate_limits">):
  UsageWindows | undefined {
  if (!available || windows === null) return undefined;
  return { fiveHour: usageWindow(windows.five_hour), sevenDay: usageWindow(windows.seven_day) };
}

type UsageQueryWindow = NonNullable<SDKControlGetUsageResponse["rate_limits"]>["five_hour"];

/** A window the query gives without its use or its reset is read as not begun. */
function usageWindow(window: UsageQueryWindow): UsageWindow {
  const percentUsed = window?.utilization ?? undefined;
  const resetsAt = window?.resets_at ?? undefined;
  return {
    percentUsed: percentUsed ?? 0,
    resetsAt: percentUsed === undefined || resetsAt === undefined ? undefined : new Date(resetsAt),
  };
}
