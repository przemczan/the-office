import type { UsageWindowName } from "../domain/usage-windows.js";

export type { KnownUsageWindowName, UsageWindowName } from "../domain/usage-windows.js";

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

/** Tokens as every token count gives them: input, output and cache writes, not cache reads. */
export function countedTokens({ input, output, cacheCreation }: TokenUsage): number {
  return input + output + cacheCreation;
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
  /** The tool call of the subagent whose call it answers, or undefined for the session's own Agent. */
  readonly withinToolCall: string | undefined;
}

/**
 * How a Sub-agent or a Process ended, as the engine saw it (spec 2.9): stopped by the Agent's
 * TaskStop, by an interrupt or by the session's end.
 */
export type BackgroundEnding =
  | { readonly state: "finished" }
  | { readonly state: "failed"; readonly reason: string }
  | { readonly state: "stopped"; readonly by: "agent" | "interrupt" | "session-end" };

/**
 * The Agent, or a Sub-agent, started a Sub-agent: with its call, before the engine says more.
 * It is known by the id of that call, which its messages name as `withinToolCall`.
 */
export interface SubAgentStartedEvent {
  readonly kind: "sub-agent-started";
  readonly callId: string;
  /** The engine's own id for it, which TaskStop names, when the engine gave one yet. */
  readonly engineTaskId: string | undefined;
  /** The Sub-agent that started it, or undefined for the session's own Agent. */
  readonly withinToolCall: string | undefined;
  readonly description: string;
  /** Its kind, such as "general-purpose" or "Explore", when the call names one. */
  readonly agentKind: string | undefined;
  /** The brief it was given. */
  readonly prompt: string;
  readonly background: boolean;
}

/** The engine told more about a Sub-agent after its start. */
export interface SubAgentChangedEvent {
  readonly kind: "sub-agent-changed";
  readonly callId: string;
  readonly engineTaskId: string | undefined;
  readonly background: boolean;
}

export interface SubAgentEndedEvent {
  readonly kind: "sub-agent-ended";
  readonly callId: string;
  readonly ending: BackgroundEnding;
  /** What it reported back, when it did. */
  readonly reportedBack: string | undefined;
  readonly toolCallCount: number | undefined;
  readonly totalTokens: number | undefined;
}

/** A command started running in the background. */
export interface ProcessStartedEvent {
  readonly kind: "process-started";
  /** The id of the `Bash` or `PowerShell` call that started it. */
  readonly callId: string;
  /** The engine's own id for it, which TaskStop names. */
  readonly engineTaskId: string;
  /** The Sub-agent that started it, or undefined for the session's own Agent. */
  readonly withinToolCall: string | undefined;
  /** Whole, as the call gave it. */
  readonly commandLine: string;
  readonly description: string;
}

/** What a Process wrote since the adapter's last read, in order: one read, one event. */
export interface ProcessOutputEvent {
  readonly kind: "process-output";
  readonly callId: string;
  readonly text: string;
}

export interface ProcessEndedEvent {
  readonly kind: "process-ended";
  readonly callId: string;
  readonly ending: BackgroundEnding;
  /** Its exit code, when the engine gives one. */
  readonly exitCode: number | undefined;
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

/**
 * The session's context as the model's latest answer in the running turn read it: that answer's
 * input, cache reads and cache writes. For showing it live; `EngineSession.readContextUsage` at
 * the turn's end stays the reading the Context policy decides on.
 */
export interface ContextReadEvent {
  readonly kind: "context-read";
  readonly tokens: number;
}

/**
 * How a turn ended. `usage-window-used-up`: the engine refused it because one of its account's usage
 * windows is used up (spec 5.4), which is no failure; the turn's end names the window.
 */
export type TurnOutcome = "completed" | "interrupted" | "failed" | "usage-window-used-up";

/**
 * How long a refused turn waits when the engine gives no reset time and none was read: long enough
 * not to spend a Start on each refusal, short enough that an hour's window lost is the worst case. A
 * turn refused again then sets the wait from what the engine says that time.
 */
export const UNKNOWN_RESET_RETRY_MS = 60 * 60 * 1000;

/** The window a refused turn found used up, and when it resets. */
export interface UsedUpWindow {
  readonly window: UsageWindowName;
  readonly resetsAt: Date;
  /**
   * False when the engine gave no reset time and `resetsAt` is `UNKNOWN_RESET_RETRY_MS` on; the
   * engine's sessions then use the latest reading of the windows, when there is one.
   */
  readonly resetGiven: boolean;
}

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
  /** For a turn refused as `usage-window-used-up`, the window and its reset; undefined otherwise. */
  readonly usedUpWindow?: UsedUpWindow;
}

export type RateLimitStatus = "allowed" | "warning" | "rejected";

/**
 * The account's quota changed state or was used: the signal to read the usage windows. It names one
 * window at most, so the windows themselves come from `EngineSession.readUsageWindows`.
 */
export interface RateLimitEvent {
  readonly kind: "rate-limit";
  readonly status: RateLimitStatus;
  /** The window it concerns, when the engine names one. */
  readonly window: UsageWindowName | undefined;
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

/** What a session reports of its Sub-agents and Processes (spec 2.9), between turns too. */
export type BackgroundEvent =
  | SubAgentStartedEvent
  | SubAgentChangedEvent
  | SubAgentEndedEvent
  | ProcessStartedEvent
  | ProcessOutputEvent
  | ProcessEndedEvent;

/** Everything a session reports, in the order it happened. */
export type SessionEvent =
  | TextEvent
  | ToolCallEvent
  | ToolResultEvent
  | ToolRefusedEvent
  | TurnTokensEvent
  | ContextReadEvent
  | TurnEndedEvent
  | RateLimitEvent
  | McpServerNotStartedEvent
  | BackgroundEvent;
