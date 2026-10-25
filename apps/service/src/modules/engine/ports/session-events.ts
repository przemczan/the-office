/**
 * The tokens one turn used, split as the engine reports them. The four parts add up to the turn's
 * tokens; none of them includes another.
 */
export interface TokenUsage {
  /** Input tokens neither read from nor written to the prompt cache. */
  readonly input: number;
  readonly output: number;
  /** Input tokens read from the prompt cache. */
  readonly cacheRead: number;
  /** Input tokens written to the prompt cache. */
  readonly cacheCreation: number;
}

/** Text the Agent wrote. */
export interface TextEvent {
  readonly kind: "text";
  readonly text: string;
  /** The tool call of the subagent that wrote it, or undefined for the session's own Agent. */
  readonly withinToolCall: string | undefined;
}

export interface ToolCallEvent {
  readonly kind: "tool-call";
  /** Unique in the session; its result names it. */
  readonly callId: string;
  /** The engine's own name for a built-in tool, or an Office tool's name. */
  readonly tool: string;
  readonly officeTool: boolean;
  readonly input: unknown;
  /** The tool call of the subagent that made it, or undefined for the session's own Agent. */
  readonly withinToolCall: string | undefined;
}

export interface ToolResultEvent {
  readonly kind: "tool-result";
  readonly callId: string;
  /** What the Agent read back, as text. */
  readonly text: string;
  readonly isError: boolean;
}

/** How a turn ended. */
export type TurnOutcome = "completed" | "interrupted" | "failed";

/** A turn ended: the session waits for a message, or takes the next one already sent. */
export interface TurnEndedEvent {
  readonly kind: "turn-ended";
  readonly outcome: TurnOutcome;
  /** The ids of the messages this turn took, in the order it took them. */
  readonly consumedMessageIds: readonly string[];
  /** This turn's tokens, without earlier turns'. */
  readonly usage: TokenUsage;
  /**
   * The session's cost so far in US dollars at list price, an estimate on a subscription. It counts
   * the turns before a resume too, which the engine keeps and a resumed session can't tell apart.
   */
  readonly sessionCostUsd: number;
  /** The output matching the session's output schema, or undefined without one or when the turn failed. */
  readonly output: unknown;
  /** Why a failed turn failed, in the engine's words. */
  readonly errors: readonly string[];
}

export type RateLimitStatus = "allowed" | "warning" | "rejected";

/**
 * The account's quota changed state or was used: the signal to read the usage windows. It names one
 * window at most, so the windows themselves come from `EngineSession.readUsageWindows`.
 */
export interface RateLimitEvent {
  readonly kind: "rate-limit";
  readonly status: RateLimitStatus;
  /** When the window it concerns resets, when the engine says. */
  readonly resetsAt: Date | undefined;
}

/** Everything a session reports, in the order it happened. */
export type SessionEvent =
  TextEvent | ToolCallEvent | ToolResultEvent | TurnEndedEvent | RateLimitEvent;
