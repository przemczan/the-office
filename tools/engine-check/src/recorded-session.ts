import type {
  HookEvent,
  HookInput,
  HookJSONOutput,
  SDKMessage,
  SDKResultMessage,
  SDKSystemMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";

/** Decides a hook call of one session; `S` is the kind of session, so a hook can use its control surface. */
export type SessionHook<S extends RecordedSession = RecordedSession> = (
  input: HookInput,
  session: S,
) => Promise<HookJSONOutput>;

export interface HookCall {
  readonly event: HookEvent;
  readonly toolUseId: string | undefined;
  readonly input: HookInput;
  /** How many stream messages had arrived when the hook was called. */
  readonly messageIndex: number;
  output?: HookJSONOutput;
}

export interface TokenUsage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheCreation: number;
}

export interface MessageDelivery {
  readonly priority?: SDKUserMessage["priority"];
  readonly shouldQuery?: boolean;
  readonly origin?: SDKUserMessage["origin"];
}

interface Waiter {
  readonly predicate: (message: SDKMessage) => boolean;
  cursor: number;
  readonly resolve: (index: number) => void;
  readonly reject: (reason: unknown) => void;
}

/**
 * One engine session a check drives, whatever route starts it: every stream message and hook call is
 * recorded, and a check waits on the messages. A subclass delivers the input and feeds the output.
 */
export abstract class RecordedSession {
  readonly messages: SDKMessage[] = [];
  readonly hookCalls: HookCall[] = [];
  readonly sessionId: string;
  readonly repository: string;
  readonly pluginFolder: string;
  private readonly stderrChunks: string[] = [];
  private readonly waiters = new Set<Waiter>();
  private resultCursor = 0;
  private ended = false;
  private failure: unknown;
  protected readonly signal: AbortSignal;

  protected constructor(
    sessionId: string,
    repository: string,
    pluginFolder: string,
    signal: AbortSignal,
  ) {
    this.sessionId = sessionId;
    this.repository = repository;
    this.pluginFolder = pluginFolder;
    this.signal = signal;
    signal.addEventListener("abort", () => this.rejectWaiters(signal.reason), { once: true });
  }

  get stderr(): string {
    return this.stderrChunks.join("");
  }

  /** Returns the uuid the message is stamped with, which a result's `user_message_uuids` names once a turn consumed it. */
  send(text: string, delivery: MessageDelivery = {}): string {
    const uuid = randomUUID();
    this.deliver({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      uuid,
      ...delivery,
    });
    return uuid;
  }

  init(): Promise<SDKSystemMessage> {
    return this.waitForMessage(
      (message): message is SDKSystemMessage =>
        message.type === "system" && message.subtype === "init",
    );
  }

  /**
   * `init` without a model call: a message that does not query still starts the session and runs the
   * turn-start attachments, the skill listing among them; its text joins the next message that queries.
   */
  async initWithoutTurn(): Promise<SDKSystemMessage> {
    this.send("Session started.", { shouldQuery: false });
    const init = await this.init();
    // That message still ends in a result; taking it here leaves nextResult() to real turns.
    await this.nextResult();
    return init;
  }

  /** The next turn's result not yet returned by an earlier call. */
  async nextResult(): Promise<SDKResultMessage> {
    const index = await this.waitForIndex(
      (message) => message.type === "result",
      this.resultCursor,
    );
    this.resultCursor = index + 1;
    return this.messages[index] as SDKResultMessage;
  }

  async waitForMessage<T extends SDKMessage>(
    predicate: (message: SDKMessage) => message is T,
    from = 0,
  ): Promise<T> {
    const index = await this.waitForIndex(predicate, from);
    return this.messages[index] as T;
  }

  /** Main-loop tokens summed over every turn; a resumed session's earlier turns are not counted again. */
  tokens(): TokenUsage {
    return this.messages
      .filter((message): message is SDKResultMessage => message.type === "result")
      .reduce<TokenUsage>(
        (total, { usage }) => ({
          input: total.input + usage.input_tokens,
          output: total.output + usage.output_tokens,
          cacheRead: total.cacheRead + usage.cache_read_input_tokens,
          cacheCreation: total.cacheCreation + usage.cache_creation_input_tokens,
        }),
        { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      );
  }

  /** Stops a command the engine moved to the background. */
  abstract stopTask(taskId: string): Promise<void>;

  /** Ends the session's input and waits for the engine to finish. */
  abstract close(): Promise<void>;

  protected abstract deliver(message: SDKUserMessage): void;

  protected record(message: SDKMessage): void {
    this.messages.push(message);
    this.notifyWaiters();
  }

  protected recordStderr(chunk: string): void {
    this.stderrChunks.push(chunk);
  }

  /** Marks the stream ended, with the error that ended it if any, so nothing waits forever. */
  protected finish(failure?: unknown): void {
    this.failure ??= failure;
    this.ended = true;
    this.notifyWaiters();
  }

  /** Records a hook call and returns what `decide` answers, or an empty answer that lets the call continue. */
  protected async recordHookCall(
    event: HookEvent,
    toolUseId: string | undefined,
    input: HookInput,
    decide: ((input: HookInput) => Promise<HookJSONOutput>) | undefined,
  ): Promise<HookJSONOutput> {
    const call: HookCall = { event, toolUseId, input, messageIndex: this.messages.length };
    this.hookCalls.push(call);
    call.output = (await decide?.(input)) ?? {};
    return call.output;
  }

  private waitForIndex(predicate: (message: SDKMessage) => boolean, from: number): Promise<number> {
    if (this.signal.aborted) {
      return Promise.reject(this.signal.reason);
    }
    return new Promise((resolve, reject) => {
      this.waiters.add({ predicate, cursor: from, resolve, reject });
      this.notifyWaiters();
    });
  }

  private notifyWaiters(): void {
    for (const waiter of this.waiters) {
      for (; waiter.cursor < this.messages.length; waiter.cursor++) {
        if (waiter.predicate(this.messages[waiter.cursor] as SDKMessage)) {
          this.waiters.delete(waiter);
          waiter.resolve(waiter.cursor);
          break;
        }
      }
      if (this.ended && this.waiters.has(waiter)) {
        this.waiters.delete(waiter);
        waiter.reject(
          this.failure ?? new Error(`Session ${this.sessionId} ended before the awaited message`),
        );
      }
    }
  }

  private rejectWaiters(reason: unknown): void {
    for (const waiter of this.waiters) {
      waiter.reject(reason);
    }
    this.waiters.clear();
  }
}
