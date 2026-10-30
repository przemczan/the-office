import type { SDKMessage, SDKSystemMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { MessagePriority, UserMessage } from "../../ports/engine-session.js";
import type { SessionEvent } from "../../ports/session-events.js";
import { sessionEvents, TurnTokens } from "./sdk-events.js";
import { ToolRefusals } from "./tool-refusals.js";

/**
 * The port's events of one session's stream, message by message, as both Claude Code adapters
 * read it: each message's own events, the tool refusals it shows, and the running turn's tokens.
 */
export class StreamEvents {
  /** Where the session's Office rules hook tells its refusals. */
  readonly refusals = new ToolRefusals();
  private readonly turnTokens = new TurnTokens();

  of(message: SDKMessage): SessionEvent[] {
    const events = sessionEvents(message).map((event) =>
      event.kind === "turn-ended" ? this.turnTokens.settled(event) : event,
    );
    return [...this.refusals.withRefusals(message, events), ...this.turnTokens.eventsOf(message)];
  }
}

/** A message to the session as the engine's input takes it; a brief goes without a priority. */
export function userMessage(
  message: UserMessage,
  priority: MessagePriority | undefined,
): SDKUserMessage {
  return {
    type: "user",
    message: { role: "user", content: message.text },
    parent_tool_use_id: null,
    // A UUID, as the port asks of message ids.
    uuid: message.id as SDKUserMessage["uuid"] & string,
    ...(priority !== undefined && { priority }),
  };
}

export function isInit(message: SDKMessage): message is SDKSystemMessage {
  return message.type === "system" && message.subtype === "init";
}

/** Why the engine stopped running a session, with the end of what it wrote to its standard error. */
export function engineStopped(error: unknown, stderr: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  const said = stderr === "" ? "" : `\n${stderr}`;
  return new Error(`The engine stopped running the session: ${message}${said}`, { cause: error });
}
