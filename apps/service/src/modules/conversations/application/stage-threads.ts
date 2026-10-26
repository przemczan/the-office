import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EngineSessions } from "../../engine/index.js";
import { RoleCards, type SessionRole } from "../../people/index.js";
import { SessionSkills } from "../../skills/index.js";
import { taskThreadBrief, type Brief } from "../domain/brief.js";
import {
  decideContext,
  type ContextDecision,
  type ContextPolicySettings,
} from "../domain/context-policy.js";
import type { Message, MessageDraft } from "../domain/message.js";
import { openingMessage, taskThreadInstructions } from "../domain/session-instructions.js";
import type { Thread, TokenTotals } from "../domain/thread.js";
import {
  beginStageWork,
  endStageWork,
  endTurn,
  failAnswer,
  freshSession,
  logMessages,
  startStageThread,
  type StageWorkEnding,
  type ThreadChange,
} from "../domain/thread-changes.js";
import { ThreadNotFound } from "../domain/thread-not-found.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { sessionLogLines, type SessionEvent } from "./session-log.js";
import { CONTEXT_POLICY_SETTINGS } from "./thread-contexts.js";

type EngineSession = Awaited<ReturnType<EngineSessions["start"]>>;
type SessionSettings = Parameters<EngineSessions["start"]>[0]["settings"];

/** What the Stage gives its sessions, beside what the person's Role card does. */
export interface StageSessionSettings {
  /** What the person does in a Stage, added to their card's instructions; the same every Stage. */
  readonly instructions: string;
  readonly profile: SessionSettings["profile"];
  readonly officeTools: readonly string[];
  /** The Stage's result schema, the same every Stage, so it stays in the cached prefix. */
  readonly outputSchema: NonNullable<SessionSettings["outputSchema"]>;
}

/** An Agent Stage beginning, as the Stage interpreter asks for its Stage Thread. */
export interface StageThreadRequest {
  readonly taskId: string;
  /** The key of the Stage's Role, whose person works it. */
  readonly roleKey: string;
  readonly stageName: string;
  /** The session the Stage declares, which wins at a Stage boundary (spec §2.5). */
  /** Undefined lets the Context policy decide, as inside a Thread. */
  readonly declared: "fresh" | "continue" | undefined;
  /** The Stage Thread of the Task's previous Stage run, when an Agent worked it. */
  readonly previousThreadId: string | undefined;
  /** The Task's record a new session's Brief starts with, as the Stage interpreter words it. */
  readonly record: string;
  /** What the Stage asks of the person now: after the Brief, or alone in a continued session. */
  readonly work: string;
  /** The Task's worktree. */
  readonly folder: string;
  /** The Project's command environment. */
  readonly environment: Readonly<Record<string, string>>;
  readonly useProjectSkills: boolean;
  readonly session: StageSessionSettings;
}

/** How a turn of the person's ended. */
export interface StageTurn {
  /** The turn's structured output; undefined when the engine gave none. */
  readonly output: unknown;
  /** Why the engine ended the turn without finishing it, in its words. */
  readonly problem: string | undefined;
  /** The turn's tokens, as the Thread counts them. */
  readonly tokens: TokenTotals;
}

/** A Stage's session at work in its Stage Thread, until the Stage ends it. */
export interface StageThread {
  readonly threadId: string;
  readonly move: ContextDecision;
  /** The person's turn running now, as it ends. */
  nextTurn(): Promise<StageTurn>;
  /** Logs `why`, sends the person The Office's `text`, and returns the turn that answers it. */
  send(text: string, why: string): Promise<StageTurn>;
  /** Ends the session, and with it every process the session left running; once. */
  endSession(): Promise<void>;
  /** Ends the Stage's work in the Thread, which then waits, and the session unless it has ended. */
  end(ending: Omit<StageWorkEnding, "roleKey">): Promise<void>;
}

/**
 * The Stage Threads on a Task's conversation (spec §2.4, §2.5): at each Agent Stage the Context
 * policy decides with the Stage's declared session whether the previous Stage's session continues
 * in its Thread, or a new Stage Thread starts with a Brief, for the same person or, at a change of
 * Role, as a hand-off. What the session reports goes into the Thread's log as it comes.
 */
@Injectable()
export class StageThreads {
  private readonly logger = new Logger(StageThreads.name);

  constructor(
    private readonly repository: ThreadRepository,
    private readonly roleCards: RoleCards,
    private readonly engine: EngineSessions,
    private readonly sessionSkills: SessionSkills,
    private readonly events: EventBus,
    @Inject(CONTEXT_POLICY_SETTINGS) private readonly settings: ContextPolicySettings,
  ) {}

  /** Throws RoleNotFound when nobody fills the Stage's Role. */
  async open(request: StageThreadRequest): Promise<StageThread> {
    const now = new Date();
    const current = await this.roleCards.forNewSession(request.roleKey);
    const previous = await this.previousThread(request.previousThreadId);
    const brief = taskThreadBrief({
      record: request.record,
      continuing: false,
      answered: await this.repository.answeredOn(request.taskId),
      open: undefined,
    });
    const move = decideContext(
      {
        now,
        session: previous?.session,
        roleKey: request.roleKey,
        sessionDefault: current.card.sessionDefault,
        override: undefined,
        declared: request.declared,
        briefTokens: brief.tokens,
      },
      this.settings,
    );
    if (move.move === "resume" && previous?.session) {
      return this.continueIn(previous, request, move, brief);
    }
    if (previous?.session) await this.forget(previous.session.id);
    return this.startIn(request, current, move, brief, now);
  }

  private async previousThread(id: string | undefined): Promise<Thread | undefined> {
    if (id === undefined) return undefined;
    const thread = await this.repository.find(id);
    if (!thread) throw new ThreadNotFound(id);
    return thread;
  }

  /** The previous Stage's session goes on in its Thread, given the Stage's work alone. */
  private async continueIn(
    previous: Thread,
    request: StageThreadRequest,
    move: ContextDecision,
    brief: Brief,
  ): Promise<StageThread> {
    const session = previous.session;
    if (!session) throw new Error(`Thread ${previous.id} has no session to continue.`);
    const role = await this.roleCards.forResumedSession(session.roleKey, session.cardVersion);
    await this.change(previous.id, (latest) =>
      beginStageWork(
        latest,
        { personName: role.card.name, decision: move, newSession: undefined, brief: brief.text },
        new Date(),
      ),
    );
    const opened = await this.opening(previous.id, undefined, async () => {
      const skills = await this.sessionSkills.rebuild(session.id);
      return this.engine.resume(session.id, this.settingsOf(previous.id, request, role, skills));
    });
    opened.send({ id: randomUUID(), text: request.work }, "later");
    return this.live(previous.id, role.roleKey, request.folder, move, opened);
  }

  /** A new Stage Thread, whose new session starts with the Brief and the Stage's work. */
  private async startIn(
    request: StageThreadRequest,
    role: SessionRole,
    move: ContextDecision,
    brief: Brief,
    now: Date,
  ): Promise<StageThread> {
    const { thread, event } = startStageThread(
      randomUUID(),
      {
        taskId: request.taskId,
        roleKey: request.roleKey,
        title: `${request.stageName} · ${role.card.name}`,
      },
      now,
    );
    await this.repository.add(thread);
    await this.events.publish(event);
    const session = freshSession(randomUUID(), role, now);
    await this.change(thread.id, (latest) =>
      beginStageWork(
        latest,
        { personName: role.card.name, decision: move, newSession: session, brief: brief.text },
        now,
      ),
    );
    const opened = await this.opening(thread.id, session.id, async () => {
      const skills = await this.sessionSkills.prepare({
        sessionId: session.id,
        roleKey: role.roleKey,
        project: { folder: request.folder, useProjectSkills: request.useProjectSkills },
      });
      return this.engine.start({
        id: session.id,
        settings: this.settingsOf(thread.id, request, role, skills),
        brief: { id: randomUUID(), text: openingMessage(brief.text, request.work) },
      });
    });
    return this.live(thread.id, role.roleKey, request.folder, move, opened);
  }

  /**
   * Opens the session, or logs why it didn't open and the Thread waits: a new session that never
   * ran gives way to none, and its skills go.
   */
  private async opening(
    threadId: string,
    newSessionId: string | undefined,
    open: () => Promise<EngineSession>,
  ): Promise<EngineSession> {
    try {
      return await open();
    } catch (error) {
      const unopened =
        newSessionId === undefined ? undefined : { sessionId: newSessionId, previous: undefined };
      await this.change(threadId, (latest) =>
        failAnswer(latest, messageOf(error), new Date(), unopened),
      );
      if (newSessionId) await this.forget(newSessionId);
      throw error;
    }
  }

  private settingsOf(
    threadId: string,
    request: StageThreadRequest,
    { roleKey, card }: SessionRole,
    skills: Awaited<ReturnType<SessionSkills["prepare"]>>,
  ): SessionSettings {
    return {
      folder: request.folder,
      environment: request.environment,
      model: card.model,
      effort: card.effort,
      instructions: taskThreadInstructions(card, request.session.instructions),
      skills: {
        folder: skills.folder,
        names: skills.names,
        expected: skills.expected,
        overrides: skills.overrides,
      },
      profile: request.session.profile,
      officeTools: [...request.session.officeTools],
      outputSchema: request.session.outputSchema,
      telemetry: {
        span: {
          "office.task": request.taskId,
          "office.thread": threadId,
          "office.role": roleKey,
          "office.stage": request.stageName,
        },
        metric: { "office.conversation.home": "task" },
      },
    };
  }

  private live(
    threadId: string,
    roleKey: string,
    folder: string,
    move: ContextDecision,
    session: EngineSession,
  ): StageThread {
    const events = session.events[Symbol.asyncIterator]();
    const logger = { roleKey, folder, handingOver: false };
    const nextTurn = async (): Promise<StageTurn> => {
      for (;;) {
        const next = await events.next();
        if (next.done) throw new Error("The session ended before the Stage's turn did.");
        if (next.value.kind === "turn-ended") return this.turnEnded(threadId, session, next.value);
        const lines = sessionLogLines(next.value, logger);
        if (lines.length > 0) await this.log(threadId, lines);
      }
    };
    let sessionEnded: Promise<void> | undefined;
    // The engine ends what the session left running as the session ends.
    const endSession = (): Promise<void> => {
      sessionEnded ??= session.end().catch((error: unknown) => {
        this.logger.warn(`Thread ${threadId}'s session didn't end cleanly: ${messageOf(error)}`);
      });
      return sessionEnded;
    };
    return {
      threadId,
      move,
      nextTurn,
      send: async (text, why) => {
        await this.log(threadId, [{ kind: "failure", reason: why }]);
        session.send({ id: randomUUID(), text }, "later");
        return nextTurn();
      },
      endSession,
      end: async (ending) => {
        await endSession();
        await this.change(threadId, (latest) =>
          endStageWork(latest, { ...ending, roleKey }, new Date()),
        );
      },
    };
  }

  /** Counts the turn on the Thread, which stays answering until the Stage ends. */
  private async turnEnded(
    threadId: string,
    session: EngineSession,
    turn: Extract<SessionEvent, { kind: "turn-ended" }>,
  ): Promise<StageTurn> {
    const problem =
      turn.outcome === "completed"
        ? undefined
        : turn.errors.join(" ") ||
          (turn.outcome === "interrupted"
            ? "The turn was interrupted."
            : "The engine ended the turn.");
    const usage = await session.readContextUsage();
    await this.change(threadId, (thread) =>
      endTurn(thread, {
        usage: turn.usage,
        contextTokens: usage.tokens,
        handingOver: false,
        officeSendsNext: true,
        endedAt: new Date(),
      }),
    );
    return { output: turn.output, problem, tokens: turn.usage };
  }

  /** A session that won't be resumed: its skills folder goes, and a failure there only warns. */
  private async forget(sessionId: string): Promise<void> {
    await this.sessionSkills.forget(sessionId).catch((error: unknown) => {
      this.logger.warn(`Session ${sessionId}'s skills stay: ${messageOf(error)}`);
    });
  }

  private async log(threadId: string, drafts: readonly MessageDraft[]): Promise<void> {
    const at = new Date();
    const messages = drafts.map((draft): Message => ({ ...draft, id: randomUUID(), threadId, at }));
    await this.change(threadId, (thread) => logMessages(thread, messages, at));
  }

  private async change<Event extends DomainEvent>(
    threadId: string,
    change: (thread: Thread) => ThreadChange<Event> | undefined,
  ): Promise<void> {
    const { event } = await this.repository.update(threadId, change);
    if (event) await this.events.publish(event);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
