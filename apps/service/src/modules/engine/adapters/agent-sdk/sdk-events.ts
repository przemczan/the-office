import type {
  SDKAssistantMessage,
  SDKControlGetUsageResponse,
  SDKMessage,
  SDKRateLimitEvent,
  SDKResultMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { UsageWindow, UsageWindows } from "../../ports/engine-session.js";
import type { RateLimitStatus, SessionEvent, TurnOutcome } from "../../ports/session-events.js";
import { OFFICE_TOOL_PREFIX } from "./sdk-options.js";

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

function assistantEvents({ message, parent_tool_use_id }: SDKAssistantMessage): SessionEvent[] {
  const withinToolCall = parent_tool_use_id ?? undefined;
  return message.content.flatMap((block): SessionEvent[] => {
    switch (block.type) {
      case "text":
        return [{ kind: "text", text: block.text, withinToolCall }];
      case "tool_use": {
        const officeTool = block.name.startsWith(OFFICE_TOOL_PREFIX);
        return [
          {
            kind: "tool-call",
            callId: block.id,
            tool: officeTool ? block.name.slice(OFFICE_TOOL_PREFIX.length) : block.name,
            officeTool,
            input: block.input,
            withinToolCall,
          },
        ];
      }
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

function usageWindow(window: UsageQueryWindow): UsageWindow {
  return {
    percentUsed: window?.utilization ?? 0,
    resetsAt: window?.resets_at == null ? undefined : new Date(window.resets_at),
  };
}
