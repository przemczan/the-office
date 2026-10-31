import { AsyncChannel } from "../../../../platform/streams/async-channel.js";
import type { ToolDecision } from "../../domain/office-rules.js";
import type { UsageWindows } from "../../domain/usage-windows.js";
import { CapabilityMissing } from "../../ports/agent-engine.js";
import type {
  ContextUsage,
  EngineSession,
  MessagePriority,
  UserMessage,
} from "../../ports/engine-session.js";
import type { SessionEvent, TokenUsage, TurnOutcome } from "../../ports/session-events.js";
import type { ToolContext, ToolOutput } from "./built-in-tool.js";
import { ChatCompletionsError, type ChatCompletionsClient } from "./chat-completions-client.js";
import type { ChatMessage, SystemMessage, ToolCall, ToolMessage } from "./chat-completions.js";
import type { Completion } from "./completion-assembly.js";
import type { SessionTools } from "./session-tools.js";

/** What a session runs on and is held to. */
export interface ApiSessionParts {
  readonly client: ChatCompletionsClient;
  /** The model's id at its API endpoint. */
  readonly model: string;
  readonly system: SystemMessage;
  readonly tools: SessionTools;
  readonly toolContext: ToolContext;
  /** The Office rules' decision on a call, as `toolDecision` gives it. */
  judge(tool: string, input: unknown): Promise<ToolDecision>;
}

const NO_TOKENS: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

/**
 * A session of The Office's own agent loop: each turn sends the conversation to the API endpoint,
 * streams the answer's text, runs the tool calls it makes once the Office rules allow each, and
 * sends again until the model answers without one.
 */
export class ApiSession implements EngineSession {
  private readonly reported = new AsyncChannel<SessionEvent>();
  private readonly conversation: ChatMessage[] = [];
  /** Messages sent and not yet taken by a turn. */
  private readonly waiting: UserMessage[] = [];
  private readonly ending = new AbortController();
  private running: Promise<void> | undefined;
  private failed = false;

  constructor(
    readonly id: string,
    private readonly parts: ApiSessionParts,
  ) {}

  get events(): AsyncIterable<SessionEvent> {
    return this.reported;
  }

  /** Without barge-in, a message sent while a turn runs waits for the next turn, `next` or not. */
  send(message: UserMessage, _priority: MessagePriority): void {
    if (this.ending.signal.aborted || this.failed) return;
    this.waiting.push(message);
    this.running ??= this.runTurns().catch((error: unknown) => this.fail(error));
  }

  async interrupt(): Promise<void> {
    throw new CapabilityMissing("interrupt");
  }

  async readUsageWindows(): Promise<UsageWindows | undefined> {
    throw new CapabilityMissing("usageWindows");
  }

  async readContextUsage(): Promise<ContextUsage> {
    throw new CapabilityMissing("contextUsage");
  }

  async end(): Promise<void> {
    this.ending.abort(new SessionEnded());
    await this.running;
    if (!this.failed) this.reported.close();
  }

  /** Takes the waiting messages a turn at a time, until none is left. */
  private async runTurns(): Promise<void> {
    for (;;) {
      const messages = this.waiting.splice(0);
      if (messages.length === 0 || this.ending.signal.aborted) {
        this.running = undefined;
        return;
      }
      await this.turn(messages);
    }
  }

  private async turn(messages: readonly UserMessage[]): Promise<void> {
    const consumed = messages.map((message) => message.id);
    this.conversation.push(
      ...messages.map((message) => ({ role: "user", content: message.text }) as const),
    );
    let usage = NO_TOKENS;
    try {
      for (;;) {
        const completion = await this.complete();
        usage = added(usage, completion.usage);
        this.conversation.push(completion.message);
        const calls = completion.message.tool_calls ?? [];
        if (calls.length === 0) break;
        this.reported.push({ kind: "turn-tokens", soFar: usage });
        for (const call of calls) this.conversation.push(await this.toolCall(call));
      }
    } catch (error) {
      if (this.ending.signal.aborted) return;
      if (!(error instanceof ChatCompletionsError)) throw error;
      this.turnEnded("failed", consumed, usage, [error.message]);
      return;
    }
    this.turnEnded("completed", consumed, usage, []);
  }

  /** One request: its text reported as it streams, then the whole answer. */
  private async complete(): Promise<Completion> {
    const { client, model, system, tools } = this.parts;
    const answer = client.stream(
      { model, messages: [system, ...this.conversation], tools: tools.definitions },
      this.ending.signal,
    );
    for await (const event of answer) {
      if (event.kind === "completed") return event.completion;
      this.reported.push({ kind: "text", text: event.text, withinToolCall: undefined });
    }
    throw new ChatCompletionsError("The API endpoint's answer ended before it was complete.");
  }

  /**
   * Runs one call as Claude Code does: input the tool can't take is refused by the engine, then
   * the Office rules judge it, and only then does it run.
   */
  private async toolCall(call: ToolCall): Promise<ToolMessage> {
    const { name } = call.function;
    const input = parsedArguments(call.function.arguments);
    this.reported.push({
      kind: "tool-call",
      callId: call.id,
      tool: name,
      officeTool: false,
      input: input.parsed ? input.value : call.function.arguments,
      withinToolCall: undefined,
    });
    const tool = this.parts.tools.named(name);
    if (tool === undefined) {
      return this.refused(
        call,
        "engine",
        `No tool is named ${name}. The tools are ${this.parts.tools.names.join(", ")}.`,
      );
    }
    if (!input.parsed) {
      return this.refused(
        call,
        "engine",
        `The call's arguments aren't valid JSON (${input.problem}); nothing ran.`,
      );
    }
    const prepared = tool.prepare(input.value);
    if (!prepared.valid) {
      return this.refused(
        call,
        "engine",
        `The ${name} call's input doesn't fit the tool; nothing ran.\n${prepared.problem}`,
      );
    }
    const decision = await this.parts.judge(name, prepared.input);
    if (!decision.allowed) return this.refused(call, "office-rules", decision.reason);
    let output: ToolOutput;
    try {
      output = await prepared.run(this.parts.toolContext);
    } catch (error) {
      output = { text: `${name} failed: ${messageOf(error)}`, isError: true };
    }
    return this.result(call, output.text, output.isError);
  }

  /** A refused call's result, which the model reads, then the refusal. */
  private refused(
    call: ToolCall,
    refusedBy: "engine" | "office-rules",
    reason: string,
  ): ToolMessage {
    const message = this.result(call, reason, true);
    this.reported.push({
      kind: "tool-refused",
      callId: call.id,
      tool: call.function.name,
      reason,
      refusedBy,
    });
    return message;
  }

  private result(call: ToolCall, text: string, isError: boolean): ToolMessage {
    this.reported.push({ kind: "tool-result", callId: call.id, text, isError });
    return { role: "tool", tool_call_id: call.id, content: text };
  }

  private turnEnded(
    outcome: TurnOutcome,
    consumedMessageIds: readonly string[],
    usage: TokenUsage,
    errors: readonly string[],
  ): void {
    this.reported.push({
      kind: "turn-ended",
      outcome,
      consumedMessageIds,
      usage,
      // A local server has no price, and The Office knows none for other servers.
      sessionCostUsd: 0,
      output: undefined,
      errors,
    });
  }

  private fail(error: unknown): void {
    this.failed = true;
    this.running = undefined;
    this.reported.fail(error);
  }
}

/** Why a session's request was aborted: the session ended. */
class SessionEnded extends Error {
  override readonly name = "SessionEnded";

  constructor() {
    super("The session ended.");
  }
}

type ParsedArguments =
  | { readonly parsed: true; readonly value: unknown }
  | { readonly parsed: false; readonly problem: string };

/** A call's arguments; some servers send none at all for a call without input. */
function parsedArguments(text: string): ParsedArguments {
  if (text.trim() === "") return { parsed: true, value: {} };
  try {
    return { parsed: true, value: JSON.parse(text) };
  } catch (error) {
    return { parsed: false, problem: messageOf(error) };
  }
}

function added(sum: TokenUsage, usage: TokenUsage | undefined): TokenUsage {
  if (usage === undefined) return sum;
  return {
    input: sum.input + usage.input,
    output: sum.output + usage.output,
    cacheRead: sum.cacheRead + usage.cacheRead,
    cacheCreation: sum.cacheCreation + usage.cacheCreation,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
