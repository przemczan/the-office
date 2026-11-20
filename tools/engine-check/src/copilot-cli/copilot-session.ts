import {
  CopilotClient,
  type CopilotSession as SdkSession,
  type MessageOptions,
  type PermissionRequest,
  type PermissionRequestResult,
  type SessionEvent,
  type SessionHooks,
} from "@microsoft/copilot-sdk";
import type { TokenUsage } from "../recorded-session.ts";
import { tokenUsage } from "./events.ts";
import type { CopilotAccount } from "./options.ts";
import { clientOptions, sessionOptions, type CopilotSessionSpec } from "./session-options.ts";

/** What a `preToolUse` hook answers; the SDK exports the handler but not its output type. */
export type PreToolUseHookOutput = Exclude<
  Awaited<ReturnType<NonNullable<SessionHooks["onPreToolUse"]>>>,
  void
>;

export type CopilotHookEvent = "preToolUse" | "postToolUse" | "postToolUseFailure";

/** A tool hook call as the runtime made it, with what the check answered, for the report. */
export interface CopilotHookCall {
  readonly event: CopilotHookEvent;
  readonly toolName: string;
  readonly toolCallId: string | undefined;
  readonly input: unknown;
  /** A Sub-agent's call, by the hook input's `agentId`. */
  readonly subAgent: boolean;
  readonly answer: PreToolUseHookOutput | undefined;
  /** How many events the session had when the hook was called: where it falls among them. */
  readonly eventIndex: number;
}

export interface CopilotPermissionCall {
  readonly request: PermissionRequest;
  readonly result: PermissionRequestResult;
  readonly eventIndex: number;
}

/** A check's decision on a call, from its tool name and input; allowed when it answers undefined. */
export type PreToolUseDecision = (call: {
  readonly toolName: string;
  readonly input: unknown;
}) => PreToolUseHookOutput | undefined;

interface EventWaiter {
  readonly from: number;
  readonly predicate: (event: SessionEvent) => boolean;
  readonly resolve: (index: number) => void;
  readonly reject: (reason: unknown) => void;
}

const STOP_TIMEOUT_MS = 15_000;

/**
 * A session on the pinned Copilot runtime through its SDK (JSON-RPC over the runtime's stdio): one
 * runtime process per session, every event, hook call and permission request recorded in order.
 */
export class CopilotSession {
  readonly events: SessionEvent[] = [];
  readonly hookCalls: CopilotHookCall[] = [];
  readonly permissionCalls: CopilotPermissionCall[] = [];
  /** The check's decision on each call before it runs; a check may change it between turns. */
  decide: PreToolUseDecision = () => undefined;
  /** The answer to each permission request; approved once unless a check says otherwise. */
  decidePermission: (request: PermissionRequest) => PermissionRequestResult = () => ({
    kind: "approve-once",
  });
  readonly client: CopilotClient;
  private sdkSession: SdkSession | undefined;
  private readonly waiters = new Set<EventWaiter>();
  private readonly signal: AbortSignal;

  private constructor(client: CopilotClient, signal: AbortSignal) {
    this.client = client;
    this.signal = signal;
    signal.addEventListener("abort", () => this.rejectWaiters(signal.reason), { once: true });
  }

  static async start(
    account: CopilotAccount,
    spec: CopilotSessionSpec,
    signal: AbortSignal,
  ): Promise<CopilotSession> {
    const client = new CopilotClient(clientOptions(account));
    const session = new CopilotSession(client, signal);
    const options = sessionOptions(spec, {
      hooks: {
        onPreToolUse: (input) => {
          const answer = session.decide({ toolName: input.toolName, input: input.toolArgs });
          session.recordHook("preToolUse", input, answer);
          return answer ?? { permissionDecision: "allow" };
        },
        onPostToolUse: (input) => {
          session.recordHook("postToolUse", input, undefined);
        },
        onPostToolUseFailure: (input) => {
          session.recordHook("postToolUseFailure", input, undefined);
        },
      },
      onPermissionRequest: (request) => {
        const result = session.decidePermission(request);
        session.permissionCalls.push({ request, result, eventIndex: session.events.length });
        return result;
      },
      onEvent: (event) => session.record(event),
    });
    try {
      await client.start();
      session.sdkSession =
        spec.resume === undefined
          ? await client.createSession(options)
          : await client.resumeSession(spec.resume, options);
    } catch (error) {
      await session.close();
      throw error;
    }
    return session;
  }

  get started(): boolean {
    return this.sdkSession !== undefined;
  }

  get sdk(): SdkSession {
    if (this.sdkSession === undefined) {
      throw new Error("The Copilot session has not started");
    }
    return this.sdkSession;
  }

  get sessionId(): string {
    return this.sdk.sessionId;
  }

  /** Sends a message and answers its id, without waiting for the turn. */
  send(prompt: string, options: Omit<MessageOptions, "prompt"> = {}): Promise<string> {
    return this.sdk.send({ ...options, prompt });
  }

  /** Sends a message and waits for the session to go idle; answers the turn's events. */
  async turn(
    prompt: string,
    options: Omit<MessageOptions, "prompt"> = {},
  ): Promise<SessionEvent[]> {
    const from = this.events.length;
    await this.send(prompt, options);
    const idle = await this.untilIdle(from);
    return this.events.slice(from, idle + 1);
  }

  /** The index of the next `session.idle` from `from`. */
  untilIdle(from = this.events.length): Promise<number> {
    return this.waitFor((event) => event.type === "session.idle", from);
  }

  /** The index of the first event from `from` that `predicate` holds for, waiting for it if need be. */
  waitFor(predicate: (event: SessionEvent) => boolean, from = this.events.length): Promise<number> {
    const seen = this.events.slice(from).findIndex(predicate);
    if (seen !== -1) {
      return Promise.resolve(from + seen);
    }
    if (this.signal.aborted) {
      return Promise.reject(this.signal.reason);
    }
    return new Promise((resolve, reject) => {
      this.waiters.add({ from, predicate, resolve, reject });
    });
  }

  /** Stops the running turn (`session.abort`). */
  interrupt(): Promise<void> {
    return this.sdk.abort();
  }

  tokens(): TokenUsage {
    return tokenUsage(this.events);
  }

  /** Disconnects the session, keeping it on disk for a resume, and stops its runtime process. */
  async close(): Promise<void> {
    this.rejectWaiters(new Error("The Copilot session closed"));
    await this.sdkSession?.disconnect().catch(() => undefined);
    const stopped = await Promise.race([
      this.client.stop().then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), STOP_TIMEOUT_MS)),
    ]);
    if (!stopped) {
      await this.client.forceStop();
    }
  }

  private record(event: SessionEvent): void {
    const index = this.events.push(event) - 1;
    for (const waiter of this.waiters) {
      if (index >= waiter.from && waiter.predicate(event)) {
        this.waiters.delete(waiter);
        waiter.resolve(index);
      }
    }
  }

  private recordHook(
    event: CopilotHookEvent,
    input: {
      readonly toolName: string;
      readonly toolCallId?: string;
      readonly toolArgs: unknown;
      readonly agentId?: string;
    },
    answer: PreToolUseHookOutput | undefined,
  ): void {
    this.hookCalls.push({
      event,
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      input: input.toolArgs,
      subAgent: input.agentId !== undefined,
      answer,
      eventIndex: this.events.length,
    });
  }

  private rejectWaiters(reason: unknown): void {
    for (const waiter of this.waiters) {
      waiter.reject(reason);
    }
    this.waiters.clear();
  }
}
