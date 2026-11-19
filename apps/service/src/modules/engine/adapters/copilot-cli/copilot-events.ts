import {
  addedTokens,
  NO_TOKENS,
  type SessionEvent,
  type TokenUsage,
  type TurnEndedEvent,
  type TurnOutcome,
} from "../../ports/session-events.js";
import type { CopilotEvent } from "./copilot-runtime.js";
import { copilotToolCall, type CopilotToolSession } from "./copilot-tool-actions.js";

/*
 * What a Copilot CLI session reports, made of the runtime's events in the port's terms, under
 * Claude Code's tool names (spec §5.4, the Copilot CLI engine).
 *
 * Not mapped, for what the events don't give:
 * - Processes: `session.background_tasks_changed` carries no data (only that the state changed), so
 *   no Process is started, shown or ended from it; a background command shows as its call and result.
 * - Sub-agents: sessions start none, and an event of a Sub-agent (one with an `agentId`) is left out,
 *   its tokens apart, since the runtime names no tool call for it; so `withinToolCall` is always
 *   undefined.
 * - Cost: `sessionCostUsd` is 0, as the cost is priced from Model prices elsewhere, never from the
 *   runtime's own figures.
 * - Usage windows: the engine has none, so no `rate-limit` event and no `usage-window-used-up` end.
 */

type EventOf<T extends CopilotEvent["type"]> = Extract<CopilotEvent, { type: T }>;
type UserMessageData = EventOf<"user.message">["data"];
type UsageData = EventOf<"assistant.usage">["data"];

/** The session's context as `session.usage_info` last gave it. */
export interface CopilotContextUsage {
  readonly tokens: number;
  readonly limit: number;
}

export interface CopilotTurnOptions {
  /** The session's Office tools and MCP servers, which a tool's name is told apart by. */
  readonly session: CopilotToolSession;
  /** Whether the session's turns are held to an output schema: the last answer is then JSON. */
  readonly hasOutputSchema: boolean;
  /**
   * The port message a `user.message` is, or undefined when it is none the session sent (a note the
   * runtime made). Called once for each, in the order the turn took them.
   */
  messageIdOf(data: UserMessageData): string | undefined;
  /** Replaces every Server value in a failure's words the runtime gave; as they are when left out. */
  redact?(text: string): string;
}

/**
 * What the runtime's tokens are in the port's terms. The runtime's `inputTokens` holds the cache
 * reads and writes too (the recordings show it: 6122 = 3193 + 2926 + 3), while the port counts
 * input apart from them.
 */
export function copilotTokens(data: UsageData): TokenUsage {
  const cacheRead = data.cacheReadTokens ?? 0;
  const cacheCreation = data.cacheWriteTokens ?? 0;
  return {
    input: Math.max(0, (data.inputTokens ?? 0) - cacheRead - cacheCreation),
    output: data.outputTokens ?? 0,
    cacheRead,
    cacheCreation,
  };
}

/** The tokens a model call's answer read as its context: input, cache reads and cache writes. */
function contextTokens({ input, cacheRead, cacheCreation }: TokenUsage): number {
  return input + cacheRead + cacheCreation;
}

/** What one turn has gathered so far. */
interface TurnState {
  tokens: TokenUsage;
  aborted: boolean;
  errors: string[];
  consumedMessageIds: string[];
  /** The last non-empty answer of the session's own Agent. */
  lastAnswer: string | undefined;
}

function freshTurn(): TurnState {
  return {
    tokens: NO_TOKENS,
    aborted: false,
    errors: [],
    consumedMessageIds: [],
    lastAnswer: undefined,
  };
}

/**
 * Maps a session's runtime events, in order, to the port's: one `text` for each whole assistant
 * message (the deltas are left out), a tool call and its result, the turn's tokens as they come,
 * and a `turn-ended` at `session.idle`. It keeps what a turn gathers (its tokens, its abort, its
 * errors, the messages it took) and starts anew at each turn's end, so one instance serves a session.
 */
export class CopilotTurnEvents {
  private turn = freshTurn();
  private context: CopilotContextUsage | undefined;
  private readonly reportedServers = new Set<string>();

  constructor(private readonly options: CopilotTurnOptions) {}

  /** The context the runtime last reported, which `readContextUsage` answers; undefined before any. */
  contextUsage(): CopilotContextUsage | undefined {
    return this.context;
  }

  map(event: CopilotEvent): SessionEvent[] {
    // Another agent's events don't end or write the session's turn; its model calls are still its tokens.
    if (event.agentId !== undefined && event.type !== "assistant.usage") return [];
    switch (event.type) {
      case "assistant.message":
        return this.message(event.data);
      case "tool.execution_start":
        return [this.toolCall(event.data)];
      case "tool.execution_complete":
        return [this.toolResult(event.data)];
      case "assistant.usage":
        return this.usage(event);
      case "session.usage_info":
        this.context = { tokens: event.data.currentTokens, limit: event.data.tokenLimit };
        return [];
      case "user.message":
        return this.userMessage(event.data);
      case "abort":
        this.turn.aborted = true;
        return [];
      case "session.error":
        this.turn.errors.push(this.words(event.data.message));
        return [];
      case "session.idle":
        return [this.turnEnded(event.data.aborted === true)];
      case "session.mcp_servers_loaded":
        return this.mcpServers(event.data.servers);
      default:
        return [];
    }
  }

  private words(text: string): string {
    return this.options.redact?.(text) ?? text;
  }

  private message({ content }: EventOf<"assistant.message">["data"]): SessionEvent[] {
    if (content.trim() === "") return [];
    this.turn.lastAnswer = content;
    return [{ kind: "text", text: content, withinToolCall: undefined }];
  }

  private toolCall({
    toolCallId,
    toolName,
    arguments: args,
  }: EventOf<"tool.execution_start">["data"]): SessionEvent {
    const call = copilotToolCall(toolName, args, this.options.session);
    // A call the Office rules will refuse is shown as the runtime named it.
    const shown =
      call.kind === "judged"
        ? call.display
        : { tool: toolName, officeTool: false, input: args ?? {} };
    return { kind: "tool-call", callId: toolCallId, ...shown, withinToolCall: undefined };
  }

  /**
   * A refused call ends `denied` with `Denied by preToolUse hook: <reason>`; the refusal itself is
   * the engine's, from the hook, so it is only the error result here, as for any failed call.
   */
  private toolResult({
    toolCallId,
    success,
    result,
    error,
  }: EventOf<"tool.execution_complete">["data"]): SessionEvent {
    // A tool's own answer is the Agent's to read, a Server value it was asked for too; a failure's
    // words may hold one it wasn't.
    const text = success
      ? (result?.content ?? "")
      : this.words(error?.message ?? result?.content ?? "");
    return {
      kind: "tool-result",
      callId: toolCallId,
      text,
      isError: !success,
      withinToolCall: undefined,
    };
  }

  private usage(event: EventOf<"assistant.usage">): SessionEvent[] {
    const used = copilotTokens(event.data);
    this.turn.tokens = addedTokens(this.turn.tokens, used);
    const events: SessionEvent[] = [{ kind: "turn-tokens", soFar: this.turn.tokens }];
    if (event.agentId === undefined) {
      events.push({ kind: "context-read", tokens: contextTokens(used) });
    }
    return events;
  }

  private userMessage(data: UserMessageData): SessionEvent[] {
    const id = this.options.messageIdOf(data);
    if (id !== undefined) this.turn.consumedMessageIds.push(id);
    return [];
  }

  /** A server that didn't start, once for each name; `pending` and `disabled` ones haven't failed. */
  private mcpServers(
    servers: EventOf<"session.mcp_servers_loaded">["data"]["servers"],
  ): SessionEvent[] {
    const events: SessionEvent[] = [];
    for (const { name, status, error } of servers) {
      if ((status !== "failed" && status !== "needs-auth") || this.reportedServers.has(name))
        continue;
      this.reportedServers.add(name);
      const reason = error ?? (status === "needs-auth" ? "It needs signing in." : undefined);
      events.push({
        kind: "mcp-server-not-started",
        server: name,
        reason: reason === undefined ? undefined : this.words(reason),
      });
    }
    return events;
  }

  private turnEnded(idleAborted: boolean): TurnEndedEvent {
    const { tokens, aborted, errors, consumedMessageIds, lastAnswer } = this.turn;
    this.turn = freshTurn();
    const interrupted = aborted || idleAborted;
    const answer = this.answer(interrupted || errors.length > 0, lastAnswer);
    const problems = [...errors, ...answer.errors];
    const outcome: TurnOutcome =
      problems.length > 0 ? "failed" : interrupted ? "interrupted" : "completed";
    return {
      kind: "turn-ended",
      outcome,
      consumedMessageIds,
      usage: tokens,
      sessionCostUsd: 0,
      output: outcome === "completed" ? answer.output : undefined,
      errors: problems,
    };
  }

  /** The turn's answer as the output schema asks, JSON; a turn that didn't finish has none to read. */
  private answer(
    unfinished: boolean,
    lastAnswer: string | undefined,
  ): { output: unknown; errors: string[] } {
    if (!this.options.hasOutputSchema || unfinished) return { output: undefined, errors: [] };
    if (lastAnswer === undefined) {
      return {
        output: undefined,
        errors: ["The turn ended without an answer in its output schema."],
      };
    }
    try {
      return { output: JSON.parse(lastAnswer) as unknown, errors: [] };
    } catch {
      return {
        output: undefined,
        errors: ["The turn's answer isn't JSON, as its output schema asks."],
      };
    }
  }
}
