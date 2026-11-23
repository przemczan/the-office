import { Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { AsyncChannel } from "../../../../platform/streams/async-channel.js";
import type { ReadingSource, UsageWindows } from "../../domain/usage-windows.js";
import type {
  ContextUsage,
  EngineSession,
  MessagePriority,
  UserMessage,
} from "../../ports/engine-session.js";
import {
  NO_TOKENS,
  type McpServerNotStartedEvent,
  type SessionEvent,
  type TokenUsage,
  type TurnOutcome,
  type UsedUpWindow,
} from "../../ports/session-events.js";
import type { Effort, JsonSchema } from "../../ports/session-options.js";
import type { ListedSkill } from "../skills/listed-skills.js";
import { skillCommandText } from "../skills/skill-loading.js";
import type { CodexApprovals, CodexRefusal, ShellTool } from "./codex-approvals.js";
import {
  codexTokens,
  completedItemEvents,
  itemCalls,
  mergedRateLimits,
  outputReader,
  rateLimitEvent,
  refusalEvents,
  refusalNote,
  tokensBefore,
  tokensSince,
  toolCallEvent,
  toolResult,
  turnEnding,
  type CodexToolCall,
  type TurnOutput,
} from "./codex-events.js";
import {
  codexUserInput,
  type CodexNotification,
  type CodexRateLimitSnapshot,
  type CodexServerRequest,
  type CodexThreadItem,
  type CodexTurn,
  type CodexUserInput,
} from "./codex-protocol.js";
import { codexUsageWindows, codexWindowsOf, unknownWindowLengths } from "./codex-usage-windows.js";
import { codexExitWords, type CodexAppServer, type CodexRpcHandlers } from "./codex-rpc.js";

/**
 * Starts the session's app-server, initialized and on its thread: `thread/start` without a thread,
 * `thread/resume` of the one given. It ends the process itself when that fails.
 */
export type CodexConnect = (
  handlers: CodexRpcHandlers,
  threadId: string | undefined,
) => Promise<{ readonly server: CodexAppServer; readonly threadId: string }>;

/** What a session runs on and is held to. */
export interface CodexSessionParts {
  readonly connect: CodexConnect;
  /** Answers the app-server's approval requests from the session's Office rules. */
  readonly approvals: CodexApprovals;
  /** The shell the session's commands are reported as. */
  readonly shellTool: ShellTool;
  /** What the session lists, those only the user runs among them, which skill commands run. */
  readonly skills: readonly ListedSkill[];
  /** Undefined leaves it to Codex. */
  readonly effort: Effort | undefined;
  /** Whether the account has usage windows to read: a ChatGPT sign-in's, not an API key's. */
  readonly usageWindows: boolean;
  /** What each turn's answer must match, or undefined for a reply in plain words. */
  readonly outputSchema: JsonSchema | undefined;
  /** The servers that failed to start as the session opened, reported before anything else. */
  readonly mcpServersNotStarted: readonly McpServerNotStartedEvent[];
  /** Closes what the session opened beside its app-server: its MCP endpoint and servers. */
  readonly close: () => Promise<void>;
}

const logger = new Logger("CodexSession");

/** How long Stop waits for `turn/interrupt` to end the turn before it ends the app-server anyway. */
const INTERRUPT_GRACE_MS = 10_000;

interface WaitingMessage {
  readonly message: UserMessage;
  readonly priority: MessagePriority;
}

/** The turn running now: started, or being started until `turn/start` answers its id. */
interface RunningTurn {
  id: string | undefined;
  /** Settles once the id is known, or the start failed. */
  readonly started: Signal;
  /** Settles once the turn's end is reported, or the session ended. */
  readonly ended: Signal;
  readonly consumed: string[];
  /** The `next` messages steered into it, one after another, in the order they came. */
  steering: Promise<void>;
  /** How many steers the app-server refused, which wait first for the next turn, in order. */
  refusedSteers: number;
  /** What the thread held before the turn, once known. */
  before: TokenUsage | undefined;
  usage: TokenUsage;
  /** Its last agent message: the answer an output schema holds. */
  lastAnswer: string | undefined;
  /** `turn/completed` came before `turn/start` answered. */
  completedEarly: CodexTurn | undefined;
  finishing: boolean;
}

/**
 * A session on the pinned `codex app-server` (spec §5.4 Defaults, the Codex engine): one process
 * on one thread, each message a turn (`turn/start`), a `next` one steered into the running turn
 * (`turn/steer`), a `later` one held until the turn ends. Stop interrupts the turn and ends the
 * process, as a running command outlives `turn/interrupt`; the next message starts a new process
 * that resumes the thread. Items are reported as Claude Code's tool calls (`codex-events.ts`), and
 * each approval request is answered from the Office rules.
 */
export class CodexSession implements EngineSession {
  private readonly reported = new AsyncChannel<SessionEvent>();
  private readonly waiting: WaitingMessage[] = [];
  private readonly readOutput: ((answer: string | undefined) => TurnOutput) | undefined;
  private server: CodexAppServer | undefined;
  private threadId: string | undefined;
  private running: Promise<void> | undefined;
  private turn: RunningTurn | undefined;
  private ending: Promise<void> | undefined;
  private failed = false;
  /** Calls reported and not yet answered, by id. */
  private readonly openCalls = new Set<string>();
  /** Calls answered, so a declined item's completion answers none again. */
  private readonly answeredCalls = new Set<string>();
  /** The calls of each item started, by its id, so a refusal finds the path it names. */
  private readonly itemCalls = new Map<string, readonly CodexToolCall[]>();
  private rateLimits: CodexRateLimitSnapshot | undefined;
  /** The thread's tokens so far, by the process's latest update. */
  private threadTotal: TokenUsage | undefined;
  private context: ContextUsage | undefined;

  constructor(
    readonly id: string,
    private readonly parts: CodexSessionParts,
  ) {
    this.readOutput =
      parts.outputSchema === undefined ? undefined : outputReader(parts.outputSchema);
    for (const event of parts.mcpServersNotStarted) this.reported.push(event);
  }

  get events(): AsyncIterable<SessionEvent> {
    return this.reported;
  }

  /**
   * Starts the app-server on the session's thread, a new one when `threadId` is undefined, and
   * answers the thread's id. A process that ends by itself afterwards fails the session.
   */
  async connect(threadId: string | undefined): Promise<string> {
    const { server, threadId: opened } = await this.parts.connect(
      {
        notification: (notification) => this.notified(notification),
        serverRequest: (request) => this.answer(request),
      },
      threadId,
    );
    if (this.ending !== undefined) {
      await server.close();
      throw new Error("The session ended as its app-server started.");
    }
    this.server = server;
    this.threadId = opened;
    this.threadTotal = undefined;
    void this.watchExit(server);
    return opened;
  }

  /** An app-server the session didn't end, by Stop or its own end, failed it. */
  private async watchExit(server: CodexAppServer): Promise<void> {
    const exit = await server.exited;
    if (this.server === server) this.fail(new Error(codexExitWords(exit)));
  }

  send(message: UserMessage, priority: MessagePriority): void {
    if (this.ending !== undefined || this.failed) return;
    const turn = this.turn;
    if (priority === "next" && turn?.id !== undefined && !turn.finishing) {
      this.steer(turn, message);
      return;
    }
    this.waiting.push({ message, priority });
    this.running ??= this.runTurns().catch((error: unknown) => this.fail(error));
  }

  /**
   * Stops the running turn, as Stop asks (spec §5.4): `turn/interrupt` ends it, then the app-server
   * is ended with every process it started, which ends a command the interrupt leaves running. The
   * next message starts a new process on the thread. Returns once the turn has ended.
   */
  async interrupt(): Promise<void> {
    const turn = this.turn;
    if (turn === undefined) return;
    await turn.started.promise;
    const { server, threadId } = this;
    if (turn.id !== undefined && server !== undefined && threadId !== undefined) {
      await server.rpc
        .request("turn/interrupt", { threadId, turnId: turn.id })
        .catch(() => undefined);
      await Promise.race([
        turn.ended.promise,
        delay(INTERRUPT_GRACE_MS, undefined, { ref: false }),
      ]);
    }
    await this.stopAppServer();
    this.endTurn(turn, "interrupted", []);
  }

  /**
   * The account's 5-hour and 7-day windows, with no model call: `account/rateLimits/read`, else the
   * latest `account/rateLimits/updated`, each as its own Reading source. None on an API key.
   */
  async readUsageWindows(): Promise<UsageWindows | undefined> {
    if (!this.parts.usageWindows) return undefined;
    const read = await this.readRateLimits();
    if (read !== undefined) return this.windowsOf(read, "usage-endpoint");
    return this.rateLimits === undefined
      ? undefined
      : this.windowsOf(this.rateLimits, "rate-limit-headers");
  }

  /** `account/rateLimits/read`'s snapshot; undefined when there is no app-server or it fails. */
  private async readRateLimits(): Promise<CodexRateLimitSnapshot | undefined> {
    const server = this.server;
    if (server === undefined) return undefined;
    try {
      const { rateLimits } = await server.rpc.request("account/rateLimits/read", undefined);
      return codexWindowsOf(rateLimits).length === 0 ? undefined : rateLimits;
    } catch (error) {
      logger.warn(`Reading the usage windows failed: ${messageOf(error)}`);
      return undefined;
    }
  }

  private windowsOf(
    snapshot: CodexRateLimitSnapshot,
    source: ReadingSource,
  ): UsageWindows | undefined {
    const windows = codexUsageWindows(snapshot, source);
    if (windows === undefined) {
      const lengths = unknownWindowLengths(snapshot).map((minutes) => minutes ?? "no");
      logger.warn(
        `Codex reported a usage window of ${lengths.join(" and ")} minutes, left unread.`,
      );
    }
    return windows;
  }

  /**
   * The latest model call's tokens, which the next one starts from, against the model's context
   * window, from `thread/tokenUsage/updated`; none before the session's first call.
   */
  async readContextUsage(): Promise<ContextUsage> {
    return this.context ?? { tokens: 0, window: 0 };
  }

  /** Ends the app-server, the session's MCP endpoint and servers; resolves once events end. */
  end(): Promise<void> {
    this.ending ??= this.ended();
    return this.ending;
  }

  private async ended(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.turn?.started.resolve();
    this.turn?.ended.resolve();
    await server?.close();
    await this.parts.close();
    await this.running?.catch(() => undefined);
    if (!this.failed) this.reported.close();
  }

  /** Takes the waiting messages a turn at a time, until none is left. */
  private async runTurns(): Promise<void> {
    for (;;) {
      const messages = this.waiting.splice(0).map(({ message }) => message);
      if (messages.length === 0 || this.ending !== undefined || this.failed) {
        this.running = undefined;
        return;
      }
      await this.runTurn(messages);
    }
  }

  /** One turn on every message waiting, as the API engine's loop takes them. */
  private async runTurn(messages: readonly UserMessage[]): Promise<void> {
    const turn: RunningTurn = {
      id: undefined,
      started: signal(),
      ended: signal(),
      consumed: messages.map(({ id }) => id),
      steering: Promise.resolve(),
      refusedSteers: 0,
      before: this.threadTotal,
      usage: NO_TOKENS,
      lastAnswer: undefined,
      completedEarly: undefined,
      finishing: false,
    };
    this.turn = turn;
    try {
      const threadId = await this.connected();
      const input = (await Promise.all(messages.map((message) => this.input(message)))).flat();
      const started = await this.rpc().request("turn/start", {
        threadId,
        input,
        ...(this.parts.effort !== undefined && { effort: codexEffort(this.parts.effort) }),
        ...(this.parts.outputSchema === undefined ? {} : { outputSchema: this.parts.outputSchema }),
      });
      turn.id = started.turn.id;
      turn.started.resolve();
      for (const { message } of this.takeWaiting("next")) this.steer(turn, message);
      if (turn.completedEarly !== undefined) void this.finishTurn(turn, turn.completedEarly);
    } catch (error) {
      turn.started.resolve();
      if (this.ending !== undefined || this.failed) return;
      this.endTurn(turn, "failed", [messageOf(error)]);
    }
    await turn.ended.promise;
    if (this.turn === turn) this.turn = undefined;
  }

  /** The thread's id, on an app-server started anew after Stop ended the last one. */
  private async connected(): Promise<string> {
    if (this.server !== undefined && this.threadId !== undefined) return this.threadId;
    return this.connect(this.threadId);
  }

  private rpc(): CodexAppServer["rpc"] {
    if (this.server === undefined) throw new Error("The Codex app-server isn't running.");
    return this.server.rpc;
  }

  /**
   * A message as Codex takes it: a skill command as its skill loaded with the command's input
   * (Claude Code's expansion), or as written for a skill the session doesn't list; a message's
   * images after its text.
   */
  private async input({ text, skillCommand, images }: UserMessage): Promise<CodexUserInput[]> {
    if (skillCommand === undefined) return codexUserInput(text, images ?? []);
    return codexUserInput((await skillCommandText(this.parts.skills, skillCommand)) ?? text);
  }

  /**
   * Steers a `next` message into the running turn; one the app-server refuses, as the turn has just
   * ended, waits as a `later` one, before those that came after it.
   */
  private steer(turn: RunningTurn, message: UserMessage): void {
    turn.steering = turn.steering.then(() => this.steered(turn, message));
  }

  private async steered(turn: RunningTurn, message: UserMessage): Promise<void> {
    const { threadId } = this;
    try {
      if (turn.id === undefined || threadId === undefined) throw new Error("No turn runs.");
      await this.rpc().request("turn/steer", {
        threadId,
        input: await this.input(message),
        expectedTurnId: turn.id,
      });
      turn.consumed.push(message.id);
    } catch {
      if (this.ending !== undefined || this.failed) return;
      this.waiting.splice(turn.refusedSteers++, 0, { message, priority: "later" });
    }
  }

  /** Takes the waiting messages of one priority, leaving the others in their order. */
  private takeWaiting(priority: MessagePriority): WaitingMessage[] {
    const taken = this.waiting.filter((waiting) => waiting.priority === priority);
    const left = this.waiting.filter((waiting) => waiting.priority !== priority);
    this.waiting.splice(0, this.waiting.length, ...left);
    return taken;
  }

  private notified(notification: CodexNotification): void {
    switch (notification.method) {
      case "item/started":
        this.parts.approvals.itemStarted(notification.params.item);
        this.callsStarted(notification.params.item);
        return;
      case "item/completed":
        this.parts.approvals.itemCompleted(notification.params.item);
        this.itemCompleted(notification.params.turnId, notification.params.item);
        return;
      case "turn/completed":
        this.turnCompleted(notification.params.turn);
        return;
      case "thread/tokenUsage/updated":
        this.tokensUpdated(notification.params);
        return;
      case "account/rateLimits/updated":
        this.rateLimits = mergedRateLimits(this.rateLimits, notification.params.rateLimits);
        this.report(rateLimitEvent(this.rateLimits));
        return;
      default:
        return;
    }
  }

  private callsStarted(item: CodexThreadItem): void {
    const calls = itemCalls(item, this.parts.shellTool);
    if (calls.length > 0) this.itemCalls.set(item.id, calls);
    for (const call of calls) this.reportCall(call);
  }

  private itemCompleted(turnId: string, item: CodexThreadItem): void {
    // An item seen only as it completed is still reported as its calls first.
    for (const call of itemCalls(item, this.parts.shellTool)) this.reportCall(call);
    this.itemCalls.delete(item.id);
    for (const event of completedItemEvents(item)) {
      if (event.kind === "tool-result") {
        if (this.answeredCalls.has(event.callId)) continue;
        this.answered(event.callId);
      }
      this.report(event);
    }
    const turn = this.turn;
    // The turn's id is unknown until turn/start's answer is read, which its items can come with.
    if (
      item.type === "agentMessage" &&
      turn !== undefined &&
      (turn.id === undefined || turn.id === turnId)
    ) {
      turn.lastAnswer = item.text;
    }
  }

  private reportCall(call: CodexToolCall): void {
    if (this.openCalls.has(call.callId) || this.answeredCalls.has(call.callId)) return;
    this.openCalls.add(call.callId);
    this.report(toolCallEvent(call));
  }

  private answered(callId: string): void {
    this.openCalls.delete(callId);
    this.answeredCalls.add(callId);
  }

  private tokensUpdated({
    turnId,
    tokenUsage: { total, last, modelContextWindow },
  }: Extract<CodexNotification, { method: "thread/tokenUsage/updated" }>["params"]): void {
    const now = codexTokens(total);
    const turn = this.turn;
    if (turn !== undefined && (turn.id === undefined || turn.id === turnId)) {
      turn.before ??= tokensBefore(total, last);
      turn.usage = tokensSince(turn.before, now);
      this.report({ kind: "context-read", tokens: last.inputTokens });
      this.report({ kind: "turn-tokens", soFar: turn.usage });
    }
    this.threadTotal = now;
    const window = modelContextWindow ?? this.context?.window;
    if (window !== undefined) this.context = { tokens: last.totalTokens, window };
  }

  private turnCompleted(completed: CodexTurn): void {
    const turn = this.turn;
    if (turn === undefined) return;
    if (turn.id === undefined) {
      turn.completedEarly = completed;
      return;
    }
    if (turn.id === completed.id) void this.finishTurn(turn, completed);
  }

  /**
   * Reports the turn's end once its steered messages are settled, so it names each it took; with
   * an output schema, a completed turn's answer must parse and fit, or the turn failed.
   */
  private async finishTurn(turn: RunningTurn, completed: CodexTurn): Promise<void> {
    if (turn.finishing) return;
    turn.finishing = true;
    await turn.steering;
    const ending = turnEnding(
      completed,
      { usageWindows: this.parts.usageWindows, rateLimits: this.rateLimits },
      new Date(),
    );
    if (ending.outcome !== "completed" || this.readOutput === undefined) {
      this.endTurn(turn, ending.outcome, ending.errors, undefined, ending.usedUpWindow);
      return;
    }
    const read = this.readOutput(turn.lastAnswer);
    if (read.fits) this.endTurn(turn, "completed", [], read.output);
    else this.endTurn(turn, "failed", [read.problem]);
  }

  /**
   * Reports a turn's end once, each call still open answered first: an interrupted command's
   * item never completes, as its process is ended.
   */
  private endTurn(
    turn: RunningTurn,
    outcome: TurnOutcome,
    errors: readonly string[],
    output?: unknown,
    usedUpWindow?: UsedUpWindow,
  ): void {
    if (turn.ended.settled) return;
    turn.finishing = true;
    // Deleting the entry being visited is safe in a Set's iteration.
    for (const callId of this.openCalls) {
      this.answered(callId);
      this.report(
        toolResult(
          callId,
          outcome === "interrupted"
            ? "Interrupted before it finished."
            : "The turn ended before it finished.",
          true,
        ),
      );
    }
    this.report({
      kind: "turn-ended",
      outcome,
      consumedMessageIds: [...turn.consumed],
      usage: turn.usage,
      // Model prices price Codex's tokens; the engine gives no cost of its own.
      sessionCostUsd: 0,
      output,
      errors,
      ...(usedUpWindow === undefined ? {} : { usedUpWindow }),
    });
    turn.ended.resolve();
  }

  /**
   * Answers an approval request from the Office rules. A refusal is reported as the hook's are,
   * and the model is told why in a note steered into the turn, as a decline carries no reason.
   */
  private async answer(request: CodexServerRequest): Promise<unknown> {
    const { result, refusal } = await this.parts.approvals.answer(request);
    if (refusal !== undefined) this.refused(refusal);
    return result;
  }

  private refused(refusal: CodexRefusal): void {
    const callId = this.refusedCallId(refusal);
    if (!this.openCalls.has(callId) && !this.answeredCalls.has(callId)) {
      this.reportCall({ callId, tool: refusal.tool, officeTool: false, input: refusal.input });
    }
    if (this.answeredCalls.has(callId)) return;
    this.answered(callId);
    for (const event of refusalEvents(callId, refusal)) this.report(event);
    const { turn, threadId } = this;
    if (turn?.id === undefined || threadId === undefined || turn.finishing) return;
    const expectedTurnId = turn.id;
    // After the decline's answer, which the connection writes once this request's handler returns.
    setImmediate(() => {
      if (this.server === undefined) return;
      this.server.rpc
        .request("turn/steer", {
          threadId,
          input: codexUserInput(refusalNote(refusal)),
          expectedTurnId,
        })
        .catch(() => undefined);
    });
  }

  /** The call a refusal is of: a file change's by the path it names, else the item's own. */
  private refusedCallId({ callId, input }: CodexRefusal): string {
    if (callId === undefined) return `refused-${randomUUID()}`;
    const path = (input as { file_path?: unknown } | undefined)?.file_path;
    const call = this.itemCalls
      .get(callId)
      ?.find((one) => (one.input as { file_path?: unknown }).file_path === path);
    return call?.callId ?? callId;
  }

  private async stopAppServer(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    await server?.kill();
  }

  /** Kills the app-server without waiting: a failing session has nobody left to tell. */
  private abandonAppServer(): void {
    void this.stopAppServer().catch(() => undefined);
  }

  private report(event: SessionEvent): void {
    if (this.reported.isOpen) this.reported.push(event);
  }

  private fail(error: unknown): void {
    if (this.failed || this.ending !== undefined) return;
    this.failed = true;
    // Ended here, as `end()` finds no server once the session failed.
    this.abandonAppServer();
    this.reported.fail(error);
    this.turn?.started.resolve();
    this.turn?.ended.resolve();
  }
}

/** Codex's highest effort is `xhigh`: a Role card's `max` runs on it. */
export function codexEffort(effort: Effort): Effort {
  return effort === "max" ? "xhigh" : effort;
}

interface Signal {
  readonly promise: Promise<void>;
  readonly settled: boolean;
  resolve(): void;
}

function signal(): Signal {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => (resolve = settle));
  const made = {
    promise,
    settled: false,
    resolve: () => {
      made.settled = true;
      resolve();
    },
  };
  return made;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
