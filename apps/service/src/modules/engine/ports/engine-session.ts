import type { UsageWindows } from "../domain/usage-windows.js";
import type { SessionEvent } from "./session-events.js";

/** A message to the Agent. */
export interface UserMessage {
  /** A UUID the caller chooses, which the turn that takes the message names. */
  readonly id: string;
  readonly text: string;
}

/**
 * When a message sent while a turn runs reaches the Agent (spec §5.4): `next` between tool calls
 * in the running turn (barge-in), `later` after the turn. Either starts a turn when none runs.
 */
export type MessagePriority = "next" | "later";

/** How full a session's context is, read from the engine without a model call. */
export interface ContextUsage {
  /** What the context holds now. */
  readonly tokens: number;
  /** As much as the model's context window takes. */
  readonly window: number;
}

/** A running session of an engine, behind one Thread. */
export interface EngineSession {
  readonly id: string;
  /**
   * Everything the session reports, for one reader. It finishes once the session has ended, and
   * throws when the session fails.
   */
  readonly events: AsyncIterable<SessionEvent>;
  send(message: UserMessage, priority: MessagePriority): void;
  /**
   * Stops the running turn now, a running command with it (Stop, spec §2.4); the turn ends
   * `interrupted` and the session waits for a message. Needs the `interrupt` capability.
   */
  interrupt(): Promise<void>;
  /** Undefined for an account without usage windows. Needs the `usageWindows` capability. */
  readUsageWindows(): Promise<UsageWindows | undefined>;
  /** How full the context is, read between turns. Needs the `contextUsage` capability. */
  readContextUsage(): Promise<ContextUsage>;
  /** Ends the session and every process it started; resolves once its events have finished. */
  end(): Promise<void>;
}
