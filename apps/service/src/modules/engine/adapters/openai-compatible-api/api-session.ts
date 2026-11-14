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
import type {
  McpServerNotStartedEvent,
  SessionEvent,
  TokenUsage,
  TurnOutcome,
} from "../../ports/session-events.js";
import type { McpServerConnections } from "../mcp-servers/mcp-server-connections.js";
import { portToolName } from "../office-rules/office-tool-names.js";
import type { BackgroundCommands } from "./background-commands.js";
import type { SessionToolContext, ToolOutput } from "./built-in-tool.js";
import { ChatCompletionsError, type ChatCompletionsClient } from "./chat-completions-client.js";
import type {
  ChatMessage,
  SystemMessage,
  ToolCall,
  ToolDefinition,
  ToolMessage,
} from "./chat-completions.js";
import type { Completion } from "./completion-assembly.js";
import type { ConversationFile } from "./conversation-file.js";
import type { SessionTools } from "./session-tools.js";
import { STRUCTURED_OUTPUT_TOOL } from "./structured-output-tool.js";

/** What a session runs on and is held to. */
export interface ApiSessionParts {
  readonly client: ChatCompletionsClient;
  /** The model's id at its API endpoint. */
  readonly model: string;
  /** How many tokens the model's context holds, as Settings › Engines lists it. */
  readonly contextWindow: number;
  readonly system: SystemMessage;
  readonly tools: SessionTools;
  readonly toolContext: SessionToolContext;
  /**
   * The session's background commands, ended on interrupt and when the session ends, which report
   * their Processes on the session's events.
   */
  readonly backgroundCommands: BackgroundCommands;
  /** The session's MCP servers, each ended with its process tree when the session ends. */
  readonly mcpConnections: McpServerConnections;
  /** The servers that failed to start as the session opened, reported before anything else. */
  readonly mcpServersNotStarted: readonly McpServerNotStartedEvent[];
  /** Whether each turn ends in output given through StructuredOutput. */
  readonly answersInSchema: boolean;
  /** Where the conversation is kept after each turn, so the session resumes from it. */
  readonly conversationFile: ConversationFile;
  /** The conversation a resumed session kept; empty for a new one. */
  readonly kept: readonly ChatMessage[];
  /** The Office rules' decision on a call, as `toolDecision` gives it. */
  judge(tool: string, input: unknown): Promise<ToolDecision>;
}

const NO_TOKENS: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

/**
 * How often a turn that must end in output is reminded when its model answers without calling
 * StructuredOutput, before the turn fails, as Claude Code retries it within the turn.
 */
const OUTPUT_REMINDERS = 2;

const OUTPUT_REMINDER = `Your turn isn't over: call the ${STRUCTURED_OUTPUT_TOOL} tool with your answer, in the shape its input asks for.`;

/** What the conversation says where a turn was interrupted, as Claude Code marks it. */
const INTERRUPTED_NOTE = "[The user interrupted this turn.]";

interface WaitingMessage {
  readonly message: UserMessage;
  readonly priority: MessagePriority;
}

/** The turn running now, which interrupt aborts and waits for. */
interface RunningTurn {
  readonly control: AbortController;
  readonly finished: Promise<void>;
}

/** A tool call's answer, and the turn's output when it gave one. */
interface AnsweredCall {
  readonly message: ToolMessage;
  readonly output?: { readonly value: unknown };
}

/**
 * A session of The Office's own agent loop: each turn sends the conversation to the API endpoint,
 * streams the answer's text, runs the tool calls it makes once the Office rules allow each, and
 * sends again until the model answers without one. A message sent with priority `next` lands
 * between tool calls; one sent `later` waits for the turn's end (spec §5.4).
 */
export class ApiSession implements EngineSession {
  private readonly reported = new AsyncChannel<SessionEvent>();
  private readonly conversation: ChatMessage[];
  /** Messages sent and not yet taken by a turn, in the order they came. */
  private readonly waiting: WaitingMessage[] = [];
  private readonly ending = new AbortController();
  private running: Promise<void> | undefined;
  private turnRunning: RunningTurn | undefined;
  private failed = false;
  /** What the last request held, as its API endpoint counted it; undefined until one counts. */
  private requestTokens: number | undefined;

  constructor(
    readonly id: string,
    private readonly parts: ApiSessionParts,
  ) {
    this.conversation = [...parts.kept];
    for (const event of parts.mcpServersNotStarted) this.reported.push(event);
    // Between turns too; once the session failed nothing more is told.
    parts.backgroundCommands.reportTo((event) => {
      if (this.reported.isOpen) this.reported.push(event);
    });
  }

  get events(): AsyncIterable<SessionEvent> {
    return this.reported;
  }

  send(message: UserMessage, priority: MessagePriority): void {
    if (this.ending.signal.aborted || this.failed) return;
    this.waiting.push({ message, priority });
    this.running ??= this.runTurns().catch((error: unknown) => this.fail(error));
  }

  /**
   * Stops the session's work, as Stop asks (spec §5.4): the running turn's request is aborted, and
   * each running command, in the foreground or the background, is ended with every process it
   * started. Returns once the turn has ended; the session then takes waiting messages.
   */
  async interrupt(): Promise<void> {
    const turn = this.turnRunning;
    if (turn !== undefined) {
      turn.control.abort(new TurnInterrupted());
      await turn.finished.catch(() => undefined);
    }
    // After the turn's end, so that no call of it starts a command once they are ended.
    await this.parts.backgroundCommands.endAll();
  }

  async readUsageWindows(): Promise<UsageWindows | undefined> {
    throw new CapabilityMissing("usageWindows");
  }

  /**
   * The last request's prompt and answer, which the next request starts from, against the model's
   * window. Nothing is ever compacted: near the limit the session's owner asks for a handover
   * (spec §2.5). A server that counts no tokens is estimated from the conversation's length.
   */
  async readContextUsage(): Promise<ContextUsage> {
    return { tokens: this.contextTokens(), window: this.parts.contextWindow };
  }

  private contextTokens(): number {
    const { system, tools } = this.parts;
    return this.requestTokens ?? estimatedTokens([system, ...this.conversation], tools.definitions);
  }

  async end(): Promise<void> {
    this.ending.abort(new SessionEnded());
    await this.running;
    // The Processes' ends are reported as `close` ends them, before the events end.
    await Promise.all([this.parts.backgroundCommands.close(), this.parts.mcpConnections.close()]);
    if (!this.failed) this.reported.close();
  }

  /** Takes the waiting messages a turn at a time, until none is left. */
  private async runTurns(): Promise<void> {
    for (;;) {
      const messages = this.waiting.splice(0).map(({ message }) => message);
      if (messages.length === 0 || this.ending.signal.aborted) {
        this.running = undefined;
        return;
      }
      const control = new AbortController();
      const finished = this.turn(messages, AbortSignal.any([this.ending.signal, control.signal]));
      this.turnRunning = { control, finished };
      try {
        await finished;
      } finally {
        this.turnRunning = undefined;
      }
      await this.parts.conversationFile.save(this.conversation);
    }
  }

  private async turn(messages: readonly UserMessage[], signal: AbortSignal): Promise<void> {
    this.landNotices();
    const consumed = this.take(messages);
    let usage = NO_TOKENS;
    let output: { readonly value: unknown } | undefined;
    let reminders = 0;
    /** The calls of the last answer not answered yet, the first one running. */
    let unanswered: ToolCall[] = [];
    try {
      for (;;) {
        const completion = await this.complete(signal);
        usage = added(usage, completion.usage);
        this.conversation.push(completion.message);
        const calls = completion.message.tool_calls ?? [];
        unanswered = [...calls];
        if (unanswered.length === 0) {
          if (!this.parts.answersInSchema || output !== undefined) break;
          if (reminders === OUTPUT_REMINDERS) {
            this.turnEnded("failed", consumed, usage, [noOutput()]);
            return;
          }
          reminders += 1;
          this.conversation.push({ role: "user", content: OUTPUT_REMINDER });
          continue;
        }
        this.reported.push({ kind: "context-read", tokens: this.contextTokens() });
        this.reported.push({ kind: "turn-tokens", soFar: usage });
        for (const call of calls) {
          const answered = await this.toolCall(call, signal);
          this.conversation.push(answered.message);
          unanswered.shift();
          output = answered.output ?? output;
          signal.throwIfAborted();
        }
        this.landNotices();
        consumed.push(...this.take(this.takeWaiting("next")));
      }
    } catch (error) {
      // Before the session's end too: the kept conversation must answer every call it holds.
      this.answerInterrupted(unanswered);
      if (signal.aborted) {
        this.conversation.push({ role: "user", content: INTERRUPTED_NOTE });
        if (!this.ending.signal.aborted) this.turnEnded("interrupted", consumed, usage, []);
        return;
      }
      if (!(error instanceof ChatCompletionsError)) throw error;
      this.turnEnded("failed", consumed, usage, [error.message]);
      return;
    }
    this.turnEnded("completed", consumed, usage, [], output?.value);
  }

  /** Adds messages to the conversation, returning their ids. */
  private take(messages: readonly UserMessage[]): string[] {
    this.conversation.push(
      ...messages.map((message) => ({ role: "user", content: message.text }) as const),
    );
    return messages.map((message) => message.id);
  }

  /**
   * Adds the notices of background commands that ended by themselves, where Claude Code lands them:
   * as a `next` message lands, or at the next turn's start. They never start a turn themselves.
   */
  private landNotices(): void {
    for (const notice of this.parts.backgroundCommands.takeNotices()) {
      this.conversation.push({ role: "user", content: notice });
    }
  }

  /** Takes the waiting messages of one priority, leaving the others in their order. */
  private takeWaiting(priority: MessagePriority): UserMessage[] {
    const taken = this.waiting.filter((waiting) => waiting.priority === priority);
    const left = this.waiting.filter((waiting) => waiting.priority !== priority);
    this.waiting.splice(0, this.waiting.length, ...left);
    return taken.map(({ message }) => message);
  }

  /**
   * Answers the calls an interrupt left: the running one as stopped, the rest as not run, so the
   * conversation has a tool message for each call it holds, as the API asks.
   */
  private answerInterrupted([running, ...notRun]: readonly ToolCall[]): void {
    if (running === undefined) return;
    this.conversation.push(this.result(running, "Interrupted before it finished.", true));
    for (const call of notRun) {
      this.conversation.push({
        role: "tool",
        tool_call_id: call.id,
        content: "Not run: the turn was interrupted.",
      });
    }
  }

  /**
   * One request, streamed. Its text is reported once the answer is whole, as the SDK reports a
   * text block: the port's text event is what the Agent wrote, which a Thread logs as one message.
   */
  private async complete(signal: AbortSignal): Promise<Completion> {
    const { client, model, system, tools } = this.parts;
    const answer = client.stream(
      { model, messages: requestMessages(system, this.conversation), tools: tools.definitions },
      signal,
    );
    for await (const event of answer) {
      if (event.kind !== "completed") continue;
      const { usage, message } = event.completion;
      if (usage !== undefined) this.requestTokens = requestTokens(usage);
      // Local models often write a blank line before a tool call; it says nothing.
      if (message.content !== null && message.content.trim() !== "") {
        this.reported.push({ kind: "text", text: message.content, withinToolCall: undefined });
      }
      return event.completion;
    }
    throw new ChatCompletionsError("The API endpoint's answer ended before it was complete.");
  }

  /**
   * Runs one call as Claude Code does: input the tool can't take is refused by the engine, then
   * the Office rules judge it, and only then does it run.
   */
  private async toolCall(call: ToolCall, signal: AbortSignal): Promise<AnsweredCall> {
    const { name } = call.function;
    const tool = this.parts.tools.named(name);
    const input = parsedArguments(call.function.arguments);
    this.reported.push({
      kind: "tool-call",
      callId: call.id,
      tool: portToolName(name),
      officeTool: tool?.officeTool ?? false,
      input: input.parsed ? input.value : call.function.arguments,
      withinToolCall: undefined,
    });
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
      const run = prepared.run({ ...this.parts.toolContext, callId: call.id }, signal);
      // An Office tool can't be stopped, so the turn stops waiting for it; the loop's own tools
      // end on the signal and answer with what they did.
      output = await (tool.officeTool ? untilAborted(run, signal) : run);
    } catch (error) {
      if (signal.aborted) throw error;
      output = { text: `${name} failed: ${messageOf(error)}`, isError: true };
    }
    if (output.refused === true) return this.refused(call, "engine", output.text);
    const message = this.result(call, output.text, output.isError);
    if (name === STRUCTURED_OUTPUT_TOOL && !output.isError) {
      return { message, output: { value: prepared.input } };
    }
    return { message };
  }

  /** A refused call's result, which the model reads, then the refusal. */
  private refused(
    call: ToolCall,
    refusedBy: "engine" | "office-rules",
    reason: string,
  ): AnsweredCall {
    const message = this.result(call, reason, true);
    this.reported.push({
      kind: "tool-refused",
      callId: call.id,
      tool: portToolName(call.function.name),
      reason,
      refusedBy,
    });
    return { message };
  }

  private result(call: ToolCall, text: string, isError: boolean): ToolMessage {
    this.reported.push({
      kind: "tool-result",
      callId: call.id,
      text,
      isError,
      withinToolCall: undefined,
    });
    return { role: "tool", tool_call_id: call.id, content: text };
  }

  private turnEnded(
    outcome: TurnOutcome,
    consumedMessageIds: readonly string[],
    usage: TokenUsage,
    errors: readonly string[],
    output?: unknown,
  ): void {
    this.reported.push({
      kind: "turn-ended",
      outcome,
      consumedMessageIds,
      usage,
      // A local server has no price, and The Office knows none for other servers.
      sessionCostUsd: 0,
      output,
      errors,
    });
  }

  private fail(error: unknown): void {
    this.failed = true;
    this.running = undefined;
    this.reported.fail(error);
  }
}

/** Why a turn's request and commands were aborted: the session was interrupted. */
class TurnInterrupted extends Error {
  override readonly name = "TurnInterrupted";

  constructor() {
    super("The turn was interrupted.");
  }
}

/** Why a session's request was aborted: the session ended. */
class SessionEnded extends Error {
  override readonly name = "SessionEnded";

  constructor() {
    super("The session ended.");
  }
}

function noOutput(): string {
  return `The turn ended without its output: the model answered ${OUTPUT_REMINDERS + 1} times without calling ${STRUCTURED_OUTPUT_TOOL} with input that fits.`;
}

/** What `work` settles with, or the signal's reason once it aborts; `work` runs on unwatched. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  work.catch(() => undefined);
  if (signal.aborted) return Promise.reject(signal.reason as Error);
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(signal.reason as Error);
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
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

/**
 * What a request sends: the user messages that follow one another (waiting messages, a background
 * command's notice, the note of an interrupted turn) joined into one, as a strict chat template
 * refuses two in a row. The kept conversation holds them apart.
 */
function requestMessages(
  system: SystemMessage,
  conversation: readonly ChatMessage[],
): ChatMessage[] {
  const messages: ChatMessage[] = [system];
  for (const message of conversation) {
    const last = messages.at(-1);
    if (message.role === "user" && last?.role === "user") {
      messages[messages.length - 1] = {
        role: "user",
        content: `${last.content}\n\n${message.content}`,
      };
    } else {
      messages.push(message);
    }
  }
  return messages;
}

/** Everything the request held, the cached part too, and the answer, which the next one holds. */
function requestTokens(usage: TokenUsage): number {
  return usage.input + usage.cacheRead + usage.cacheCreation + usage.output;
}

/** About four characters a token, as a rough measure for a server that counts none. */
const CHARACTERS_PER_TOKEN = 4;

function estimatedTokens(
  messages: readonly ChatMessage[],
  tools: readonly ToolDefinition[],
): number {
  return Math.ceil(JSON.stringify({ messages, tools }).length / CHARACTERS_PER_TOKEN);
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
