import type { SDKMessage, SDKSystemMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { MessagePriority, UserMessage } from "../../ports/engine-session.js";
import type { SessionEvent } from "../../ports/session-events.js";
import { callAsRun } from "../office-rules/foreground-sub-agents.js";
import { BackgroundTasks } from "./background-tasks.js";
import { McpServerStarts } from "./mcp-server-starts.js";
import type { HookRewrites } from "./office-rules-hook.js";
import { RefusedTurns, sessionEvents, TurnTokens } from "./sdk-events.js";
import { ToolRefusals } from "./tool-refusals.js";

/**
 * The port's events of one session's stream, message by message, as both Claude Code adapters
 * read it: each message's own events (a turn refused for a used-up usage window told apart), the
 * tool refusals it shows, the running turn's tokens, the session's MCP servers that failed to
 * start, and its Sub-agents and Processes. What the clock
 * brings, a Process's output and its end, the session takes from `background`'s report.
 */
export class StreamEvents {
  /** Where the session's Office rules hook tells its refusals. */
  readonly refusals = new ToolRefusals();
  private readonly turnTokens = new TurnTokens();
  private readonly refusedTurns = new RefusedTurns();
  private readonly mcpServerStarts: McpServerStarts;

  /**
   * `mcpServers`: the names of the session's MCP servers; `session`: how its hook changes the calls
   * it allows; `background`: its Sub-agents and Processes, which the session reports to and tells
   * of an interrupt and of its end.
   */
  constructor(
    mcpServers: readonly string[],
    private readonly session: HookRewrites = {},
    readonly background = new BackgroundTasks(session),
  ) {
    this.mcpServerStarts = new McpServerStarts(mcpServers);
  }

  of(message: SDKMessage): SessionEvent[] {
    const events = sessionEvents(message).map((event) => {
      this.refusedTurns.seen(event);
      if (event.kind === "turn-ended") {
        return this.refusedTurns.settled(this.turnTokens.settled(event));
      }
      if (event.kind === "tool-call") return callAsRun(event, this.session);
      return event;
    });
    return [
      ...this.mcpServerStarts.eventsOf(message),
      ...this.refusals.withRefusals(message, events),
      ...this.background.eventsOf(message),
      ...this.turnTokens.eventsOf(message),
    ];
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
