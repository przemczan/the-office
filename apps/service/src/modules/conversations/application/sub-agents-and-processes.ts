import { Injectable, Logger } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { BusyWork, type EndBusyWork } from "../../busy-work/index.js";
import {
  ProcessOutputKept,
  SubAgentMessagesKept,
  SubAgentOrProcessChanged,
} from "../domain/conversation-events.js";
import { SubAgentOrProcessNotFound } from "../domain/sub-agent-or-process-not-found.js";
import {
  changeSubAgent,
  endItem,
  progressSubAgent,
  RESTART_ENDING,
  SESSION_END_ENDING,
  stateOf,
  WholeLines,
  type Ending,
  type OutputChunk,
  type SessionWhere,
  type SubAgentMessage,
  type SubAgentMessageDraft,
  type SubAgentOrProcess,
} from "../domain/sub-agents-and-processes.js";
import { ThreadNotFound } from "../domain/thread-not-found.js";
import { toolActivitySummary } from "../domain/tool-activity.js";
import type { TextMask } from "../ports/project-output-masks.js";
import { SubAgentAndProcessRepository } from "../ports/sub-agent-and-process-repository.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import type { SessionEvent } from "./session-log.js";
import { SessionStops } from "./session-stops.js";

/** About a second: how long a Process's unfinished last line is held before it is kept anyway. */
const HELD_LINE_MS = 1_000;

/** Where a session works and how its texts are masked, as its Thread's log has them. */
export interface FollowedSession extends SessionWhere {
  readonly folder: string;
  readonly mask: TextMask;
  /**
   * Whose Sub-agents run where, as a scheduled Office update lists them while any runs in the
   * background, such as `Angela's Sub-agents in an Initiative's Thread, "Planning the Initiative"`.
   */
  readonly subAgentsLabel: string;
}

/** A Sub-agent's messages read back, after a sequence. */
export interface SubAgentMessagesRead {
  readonly messages: readonly SubAgentMessage[];
  readonly lastSequence: number;
  readonly earlierNotKept: number;
}

/** A Process's output read back, after a sequence. */
export interface ProcessOutputRead {
  readonly chunks: readonly OutputChunk[];
  readonly lastSequence: number;
  /** In bytes. */
  readonly earlierNotKept: number;
}

/**
 * A session's Sub-agents and Processes (spec 2.9): kept from the events the runners read, for the
 * rest of the session, and sent live as each changes. Everything kept goes through the Project's
 * mask first, a Process's output by whole lines.
 */
@Injectable()
export class SubAgentsAndProcesses {
  private readonly logger = new Logger(SubAgentsAndProcesses.name);

  constructor(
    private readonly repository: SubAgentAndProcessRepository,
    private readonly threads: ThreadRepository,
    private readonly events: EventBus,
    private readonly busyWork: BusyWork,
    private readonly stops: SessionStops,
  ) {}

  /** Keeps what one session reports, from its start or resume until `end`. */
  follow(session: FollowedSession): SessionFollowing {
    return new SessionFollowing(
      session,
      this.repository,
      this.events,
      this.busyWork,
      this.logger,
      this.stops,
    );
  }

  /** The Thread's current session's Sub-agents and Processes, in the order they started. */
  async list(threadId: string): Promise<readonly SubAgentOrProcess[]> {
    const sessionId = await this.sessionOf(threadId);
    return sessionId === undefined ? [] : this.repository.ofSession(sessionId);
  }

  async messages(threadId: string, callId: string, after: number): Promise<SubAgentMessagesRead> {
    const item = await this.itemOf(threadId, callId, "sub-agent");
    // Read after the item, so its last sequence is never behind the messages read.
    const messages = await this.repository.messagesAfter(item, after);
    return {
      messages,
      lastSequence: Math.max(item.lastSequence, messages.at(-1)?.sequence ?? 0),
      earlierNotKept: item.earlierMessagesNotKept,
    };
  }

  async output(threadId: string, callId: string, after: number): Promise<ProcessOutputRead> {
    const item = await this.itemOf(threadId, callId, "process");
    const chunks = await this.repository.outputAfter(item, after);
    return {
      chunks,
      lastSequence: Math.max(item.lastSequence, chunks.at(-1)?.sequence ?? 0),
      earlierNotKept: item.earlierOutputNotKept,
    };
  }

  /**
   * After The Office restarted, no session reports on what was Running, and a command may still
   * run on the machine: each is Stopped, "Ended when The Office restarted". Run as the service
   * starts, before it serves, so no page is told. Returns the Threads whose background Sub-agents
   * were lost, which planning may wake again (spec 2.4).
   */
  async recover(): Promise<readonly string[]> {
    const now = new Date();
    const cutShort = new Set<string>();
    for (const item of await this.repository.running()) {
      if (item.kind === "sub-agent" && item.background) cutShort.add(item.threadId);
      const ended = endItem(item, RESTART_ENDING, now);
      if (ended) await this.repository.save(ended);
    }
    return [...cutShort];
  }

  /** A fresh session replaced the Thread's: the old one's go with it. */
  async removeSession(sessionId: string): Promise<void> {
    await this.repository.removeSession(sessionId);
  }

  private async sessionOf(threadId: string): Promise<string | undefined> {
    const thread = await this.threads.find(threadId);
    if (!thread) throw new ThreadNotFound(threadId);
    return thread.session?.id;
  }

  private async itemOf<Kind extends SubAgentOrProcess["kind"]>(
    threadId: string,
    callId: string,
    kind: Kind,
  ): Promise<Extract<SubAgentOrProcess, { kind: Kind }>> {
    const sessionId = await this.sessionOf(threadId);
    const item = sessionId && (await this.repository.find({ sessionId, callId }));
    if (!item || item.kind !== kind) throw new SubAgentOrProcessNotFound(threadId, callId);
    return item as Extract<SubAgentOrProcess, { kind: Kind }>;
  }
}

/**
 * One session's events, kept in the order they came: each is handled after the one before, and a
 * held line's flush takes its turn among them. While any of its Sub-agents runs in the background
 * the session counts as busy work a scheduled Office update waits for (spec 2.9): its turn no
 * longer does. A foreground Sub-agent runs within its turn, and a Process may never end, so
 * neither counts.
 */
export class SessionFollowing {
  private queue: Promise<void> = Promise.resolve();
  /** Each running Process's output, handed on by whole lines. */
  private readonly lines = new Map<string, WholeLines>();
  private readonly heldLineTimers = new Map<string, NodeJS.Timeout>();
  /** The Sub-agents this session started, by `callId`. */
  private readonly subAgents = new Set<string>();
  /** Each tool call a Sub-agent made, to the Sub-agent: a refusal names only the call. */
  private readonly subAgentCalls = new Map<string, string>();
  /** The Sub-agents running in the background now, by `callId`. */
  private readonly inBackground = new Set<string>();
  private endBusyWork: EndBusyWork | undefined;
  private backgroundSubAgentsEnded: (() => void) | undefined;
  private ended = false;

  constructor(
    private readonly session: FollowedSession,
    private readonly repository: SubAgentAndProcessRepository,
    private readonly events: EventBus,
    private readonly busyWork: BusyWork,
    private readonly logger: Logger,
    private readonly stops: SessionStops,
  ) {
    // A resumed session goes on with what it started before.
    // oxlint-disable-next-line office/caught-voided-calls -- a turn logs its own failure
    void this.inTurn(async () => {
      for (const item of await this.repository.ofSession(session.sessionId)) {
        if (item.kind === "sub-agent") {
          this.subAgents.add(item.callId);
          this.count(item);
        } else if (stateOf(item) === "running") this.lines.set(item.callId, new WholeLines());
      }
    });
  }

  /** Whether any of the session's Sub-agents runs in the background now. */
  get backgroundSubAgentsRunning(): boolean {
    return this.inBackground.size > 0;
  }

  /** Calls `listener` each time the last background Sub-agent running ends, until the session's end. */
  whenBackgroundSubAgentsEnd(listener: () => void): void {
    this.backgroundSubAgentsEnded = listener;
  }

  /** Keeps what the event says of a Sub-agent or a Process; any other event changes nothing. */
  take(event: SessionEvent): Promise<void> {
    if (this.ended) return this.queue;
    return this.inTurn(() => this.handle(event));
  }

  /**
   * The session ended: held lines are kept, and whatever still runs is Stopped with the session,
   * an Office tool's work waiting on `SessionStops` too. Nothing it reports later is kept.
   */
  end(): Promise<void> {
    if (this.ended) return this.queue;
    this.ended = true;
    this.stops.stopped(this.session.sessionId);
    return this.inTurn(async () => {
      for (const timer of this.heldLineTimers.values()) clearTimeout(timer);
      this.heldLineTimers.clear();
      for (const callId of this.lines.keys()) await this.keepHeldLine(callId);
      const now = new Date();
      try {
        for (const item of await this.repository.ofSession(this.session.sessionId)) {
          if (stateOf(item) === "running") await this.endAs(item, SESSION_END_ENDING, now);
        }
      } finally {
        // Ended with the session, kept or not: the update waits for them no longer.
        this.inBackground.clear();
        this.endBusyWork?.();
        this.endBusyWork = undefined;
      }
    });
  }

  /** Runs `work` after the turns before it; never rejects, as a failure is logged here. */
  private inTurn(work: () => Promise<void>): Promise<void> {
    const turn = this.queue.then(work).catch((error: unknown) => {
      // A failure to keep one event loses only that event; the session reads on.
      this.logger.error(
        `Session ${this.session.sessionId}'s Sub-agents and Processes weren't all kept: ${messageOf(error)}`,
      );
    });
    this.queue = turn;
    return turn;
  }

  private async handle(event: SessionEvent): Promise<void> {
    const { mask } = this.session;
    const now = new Date();
    switch (event.kind) {
      case "sub-agent-started": {
        this.subAgents.add(event.callId);
        await this.started({
          ...this.itemFields(event.callId, event.engineTaskId, event.withinToolCall, now),
          kind: "sub-agent",
          description: mask.mask(event.description),
          agentKind: event.agentKind,
          prompt: mask.mask(event.prompt),
          background: event.background,
          reportedBack: undefined,
          toolCallCount: undefined,
          totalTokens: undefined,
          earlierMessagesNotKept: 0,
        });
        return;
      }
      case "sub-agent-changed": {
        const item = await this.find(event.callId);
        const changed = item?.kind === "sub-agent" ? changeSubAgent(item, event) : undefined;
        if (changed) await this.saved(changed, "changed", now);
        return;
      }
      case "sub-agent-progress": {
        const item = await this.find(event.callId);
        const progressed =
          item?.kind === "sub-agent" ? progressSubAgent(item, event.totalTokens) : undefined;
        if (progressed) await this.saved(progressed, "changed", now);
        return;
      }
      case "sub-agent-ended": {
        const item = await this.find(event.callId);
        if (item) {
          await this.endAs(item, this.masked(event.ending), now, {
            reportedBack:
              event.reportedBack === undefined ? undefined : mask.mask(event.reportedBack),
            toolCallCount: event.toolCallCount,
            totalTokens: event.totalTokens,
          });
        }
        return;
      }
      case "process-started": {
        this.lines.set(event.callId, new WholeLines());
        await this.started({
          ...this.itemFields(event.callId, event.engineTaskId, event.withinToolCall, now),
          kind: "process",
          description: mask.mask(event.description),
          commandLine: mask.mask(event.commandLine),
          exitCode: undefined,
          earlierOutputNotKept: 0,
        });
        return;
      }
      case "process-output":
        await this.output(event.callId, event.text);
        return;
      case "process-ended": {
        this.clearHeldLineTimer(event.callId);
        await this.keepHeldLine(event.callId);
        this.lines.delete(event.callId);
        const item = await this.find(event.callId);
        if (item) {
          await this.endAs(item, this.masked(event.ending), now, { exitCode: event.exitCode });
        }
        return;
      }
      default: {
        const message = this.subAgentMessageOf(event);
        if (message) await this.keepMessage(message.callId, message.draft, now);
      }
    }
  }

  private itemFields(
    callId: string,
    engineTaskId: string | undefined,
    startedBy: string | undefined,
    now: Date,
  ) {
    return {
      threadId: this.session.threadId,
      sessionId: this.session.sessionId,
      callId,
      engineTaskId,
      startedBy,
      ending: undefined,
      startedAt: now,
      endedAt: undefined,
      revision: 0,
      lastSequence: 0,
    };
  }

  private async started(item: SubAgentOrProcess): Promise<void> {
    // A resumed session may report one again: the first kept stays.
    if (!(await this.repository.add(item))) return;
    this.count(item);
    await this.events.publish(
      new SubAgentOrProcessChanged(this.whereOf(), item, "started", item.startedAt),
    );
  }

  private async saved(
    item: SubAgentOrProcess,
    change: "changed" | "ended",
    at: Date,
  ): Promise<void> {
    await this.repository.save(item);
    this.count(item);
    await this.events.publish(new SubAgentOrProcessChanged(this.whereOf(), item, change, at));
  }

  private async endAs(
    item: SubAgentOrProcess,
    ending: Ending,
    at: Date,
    added: Parameters<typeof endItem>[3] = {},
  ): Promise<void> {
    const ended = endItem(item, ending, at, added);
    if (ended) await this.saved(ended, "ended", at);
  }

  /** Counts a Sub-agent among those running in the background, or no longer, as it is now. */
  private count(item: SubAgentOrProcess): void {
    if (item.kind !== "sub-agent" || this.ended) return;
    if (item.background && stateOf(item) === "running") {
      this.inBackground.add(item.callId);
      this.endBusyWork ??= this.busyWork.begin({
        kind: "sub-agents",
        label: this.session.subAgentsLabel,
      });
      return;
    }
    if (!this.inBackground.delete(item.callId) || this.inBackground.size > 0) return;
    this.endBusyWork?.();
    this.endBusyWork = undefined;
    this.backgroundSubAgentsEnded?.();
  }

  private find(callId: string): Promise<SubAgentOrProcess | undefined> {
    return this.repository.find({ sessionId: this.session.sessionId, callId });
  }

  /** A failure's reason goes through the mask too. */
  private masked(ending: Ending): Ending {
    return ending.state === "failed"
      ? { ...ending, reason: this.session.mask.mask(ending.reason) }
      : ending;
  }

  private async output(callId: string, text: string): Promise<void> {
    const lines = this.lines.get(callId) ?? new WholeLines();
    this.lines.set(callId, lines);
    const whole = lines.push(text);
    if (whole !== "") await this.keepOutput(callId, whole);
    this.clearHeldLineTimer(callId);
    if (lines.holding) {
      const timer = setTimeout(() => {
        this.heldLineTimers.delete(callId);
        // oxlint-disable-next-line office/caught-voided-calls -- a turn logs its own failure
        void this.inTurn(() => this.keepHeldLine(callId));
      }, HELD_LINE_MS);
      timer.unref();
      this.heldLineTimers.set(callId, timer);
    }
  }

  private async keepHeldLine(callId: string): Promise<void> {
    const held = this.lines.get(callId)?.flush() ?? "";
    if (held !== "") await this.keepOutput(callId, held);
  }

  private async keepOutput(callId: string, text: string): Promise<void> {
    const chunk = await this.repository.addOutput(
      { sessionId: this.session.sessionId, callId },
      this.session.mask.mask(text),
    );
    if (chunk) {
      await this.events.publish(new ProcessOutputKept(this.whereOf(), callId, chunk, new Date()));
    }
  }

  private clearHeldLineTimer(callId: string): void {
    const timer = this.heldLineTimers.get(callId);
    if (timer) clearTimeout(timer);
    this.heldLineTimers.delete(callId);
  }

  /**
   * A Sub-agent's text, tool call or refusal, summed up as `sessionLogLines` does the Agent's: the
   * events whose `withinToolCall` is a Sub-agent of this session, and a refusal of a call one made.
   */
  private subAgentMessageOf(
    event: SessionEvent,
  ): { readonly callId: string; readonly draft: SubAgentMessageDraft } | undefined {
    const { mask, folder } = this.session;
    switch (event.kind) {
      case "text":
        return this.ofSubAgent(event.withinToolCall, {
          kind: "text",
          text: mask.mask(event.text),
        });
      case "tool-call":
        if (event.withinToolCall === undefined || !this.subAgents.has(event.withinToolCall)) {
          return undefined;
        }
        this.subAgentCalls.set(event.callId, event.withinToolCall);
        return this.ofSubAgent(event.withinToolCall, {
          kind: "tool-activity",
          tool: event.tool,
          summary: mask.mask(toolActivitySummary(event.input, folder)),
        });
      case "tool-refused":
        return this.ofSubAgent(this.subAgentCalls.get(event.callId), {
          kind: "refusal",
          tool: event.tool,
          reason: mask.mask(event.reason),
        });
      default:
        return undefined;
    }
  }

  private ofSubAgent(
    callId: string | undefined,
    draft: SubAgentMessageDraft,
  ): { readonly callId: string; readonly draft: SubAgentMessageDraft } | undefined {
    return callId !== undefined && this.subAgents.has(callId) ? { callId, draft } : undefined;
  }

  private async keepMessage(callId: string, draft: SubAgentMessageDraft, at: Date): Promise<void> {
    const messages = await this.repository.addMessages(
      { sessionId: this.session.sessionId, callId },
      [draft],
      at,
    );
    if (messages.length > 0) {
      await this.events.publish(new SubAgentMessagesKept(this.whereOf(), callId, messages, at));
    }
  }

  private whereOf(): SessionWhere {
    const { threadId, home, sessionId } = this.session;
    return { threadId, home, sessionId };
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
