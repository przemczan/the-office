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

export const NO_TOKENS: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

export function addedTokens(one: TokenUsage, other: TokenUsage): TokenUsage {
  return {
    input: one.input + other.input,
    output: one.output + other.output,
    cacheRead: one.cacheRead + other.cacheRead,
    cacheCreation: one.cacheCreation + other.cacheCreation,
  };
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

/** Who refused a tool call: the Office rules (spec §6), or the engine's own checks. */
export type RefusedBy = "office-rules" | "engine";

/** A tool call was refused; its result, which the Agent read, follows it or came before. */
export interface ToolRefusedEvent {
  readonly kind: "tool-refused";
  readonly callId: string;
  /** As its call names it. */
  readonly tool: string;
  readonly reason: string;
  readonly refusedBy: RefusedBy;
}

/**
 * The running turn's tokens so far, counted from the Agent's messages as the engine reports them,
 * each message once. An estimate for showing a long turn live: the turn's own `usage`, as it ends,
 * replaces it.
 */
export interface TurnTokensEvent {
  readonly kind: "turn-tokens";
  readonly soFar: TokenUsage;
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

/**
 * One of the session's MCP servers failed to start, reported once for each start of the session.
 * The session goes on: the engine leaves the server's tools out, or each call answers why.
 */
export interface McpServerNotStartedEvent {
  readonly kind: "mcp-server-not-started";
  /** As the session's MCP servers name it. */
  readonly server: string;
  /** Why, with every Server value of the session replaced; undefined when the engine doesn't say. */
  readonly reason: string | undefined;
}

/** Everything a session reports, in the order it happened. */
export type SessionEvent =
  | TextEvent
  | ToolCallEvent
  | ToolResultEvent
  | ToolRefusedEvent
  | TurnTokensEvent
  | TurnEndedEvent
  | RateLimitEvent
  | McpServerNotStartedEvent;
