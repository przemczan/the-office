import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EngineSessions, type Engine } from "../../engine/index.js";
import { SessionMcpServers, type LeftOutMcpServer } from "../../mcp-servers/index.js";
import {
  mcpToolSettingsFor,
  RoleCards,
  type McpToolSettings,
  type SessionRole,
} from "../../people/index.js";
import { ApprovalHolds } from "./approval-holds.js";
import { SessionSkills } from "../../skills/index.js";
import { taskThreadBrief, type Brief } from "../domain/brief.js";
import { decideContext, type ContextDecision } from "../domain/context-policy.js";
import type { Decision } from "../domain/decision.js";
import type {
  Message,
  MessageDelivery,
  MessageDraft,
  StageWorkClosing,
} from "../domain/message.js";
import { SessionMemory } from "./session-memory.js";
import {
  openingMessage,
  withLeftOutServers,
  roleOfficeTools,
  sessionOfficeTools,
  workThreadInstructions,
} from "../domain/session-instructions.js";
import {
  addTokens,
  NO_TOKENS,
  type Thread,
  type ThreadSession,
  type TokenTotals,
} from "../domain/thread.js";
import {
  bargeIn,
  beginStageWork,
  chooseOverride,
  countRunningTurn,
  endStageWork,
  endTurn,
  failAnswer,
  freshSession,
  logMessages,
  markDelivery,
  startStageThread,
  type StageWorkEnding,
  type ThreadChange,
} from "../domain/thread-changes.js";
import { ThreadNotFound } from "../domain/thread-not-found.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import {
  undeliveredSince,
  waitingMessageIds,
  workWithUndelivered,
} from "../domain/undelivered-messages.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { BargeIns } from "./barge-ins.js";
import { sessionLogLines, type SessionEvent } from "./session-log.js";
import { ContextPolicySettingsService } from "./context-policy-settings.js";

type EngineSession = Awaited<ReturnType<EngineSessions["start"]>>;
type SessionSettings = Parameters<EngineSessions["start"]>[0]["settings"];

/** What the Stage gives its sessions, beside what the person's Role card does. */
export interface StageSessionSettings {
  /** What the person does in a Stage, added to their card's instructions; the same every Stage. */
  readonly instructions: string;
  /** The session's profile, but its MCP tools' settings as the card keeps them: those set only. */
  readonly profile: Omit<SessionSettings["profile"], "mcpTools"> & {
    readonly mcpTools: McpToolSettings;
  };
  readonly officeTools: readonly string[];
  /** The Stage's result schema, the same every Stage, so it stays in the cached prefix. */
  readonly outputSchema: NonNullable<SessionSettings["outputSchema"]>;
}

/** An Agent Stage beginning, as the Stage interpreter asks for its Stage Thread. */
export interface StageThreadRequest {
  readonly taskId: string;
  /** The Task's Project, whose Memory notes the person's session reads. */
  readonly projectId: string;
  /** The key of the Stage's Role, whose person works it. */
  readonly roleKey: string;
  readonly stageName: string;
  /** The Stage's own model; undefined keeps the Role card's. */
  readonly model: string | undefined;
  /** The Stage's own effort; undefined keeps the Role card's. */
  readonly effort: SessionSettings["effort"] | undefined;
  /** The session the Stage declares, which wins at a Stage boundary (spec §2.5). */
  /** Undefined lets the Context policy decide, as inside a Thread. */
  readonly declared: "fresh" | "continue" | undefined;
  /** The Stage Thread of the Task's previous Stage run, when an Agent worked it. */
  readonly previousThreadId: string | undefined;
  /**
   * When the Stage runs again after the user held its last run: its start. The user's messages
   * into the previous Thread since then that never reached the person go with the work.
   */
  readonly carryMessagesSince: Date | undefined;
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

/** What decides a Stage's session: who works it, after which Thread, and the Brief's record. */
type StageSessionRequest = Pick<
  StageThreadRequest,
  "taskId" | "projectId" | "roleKey" | "declared" | "previousThreadId" | "record"
>;

/** What a Stage's session would be were it to begin now. */
export interface StageSessionAhead {
  readonly move: ContextDecision["move"];
  readonly cacheWarm: boolean;
  readonly contextTokens: number;
  readonly briefTokens: number;
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

/** A Decision the person asked in a Stage Thread, with the id it is answered by. */
export type AskedDecision = Pick<
  Decision,
  "id" | "question" | "context" | "options" | "recommendation"
>;

/**
 * The user's messages a Stage's work carries into its session, from the Thread they were written
 * in, by the id of The Office's message that carries them.
 */
interface CarriedMessages {
  readonly threadId: string;
  readonly messageIds: readonly string[];
  readonly carrierId: string;
}

/** A Stage's session at work in its Stage Thread, until the Stage ends it. */
export interface StageThread {
  readonly threadId: string;
  readonly move: ContextDecision;
  /** The person's turn running now, as it ends. */
  nextTurn(): Promise<StageTurn>;
  /**
   * The latest Decision the person opened in the Thread since the Stage's work began, by
   * `open_decision` or `consult`, answered or not; undefined when they asked none.
   */
  askedDecision(): Promise<AskedDecision | undefined>;
  /** Logs `why`, sends the person The Office's `text`, and returns the turn that answers it. */
  send(text: string, why: string): Promise<StageTurn>;
  /**
   * Stops the person's running turn now (Stop, spec §2.4), a running command with it: the turn
   * ends interrupted. On an engine that can't interrupt, the session ends instead. Does nothing
   * between turns or once the session has ended.
   */
  interrupt(): Promise<void>;
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
  /** The user's messages into each Stage Thread whose Stage's session is at work. */
  private readonly bargeIns = new Map<string, BargeIns>();

  constructor(
    private readonly repository: ThreadRepository,
    private readonly roleCards: RoleCards,
    private readonly engine: EngineSessions,
    private readonly sessionSkills: SessionSkills,
    private readonly sessionMcpServers: SessionMcpServers,
    private readonly events: EventBus,
    private readonly settings: ContextPolicySettingsService,
    private readonly memory: SessionMemory,
    private readonly approvalHolds: ApprovalHolds,
  ) {}

  /** Throws RoleNotFound when nobody fills the Stage's Role. */
  async open(request: StageThreadRequest): Promise<StageThread> {
    const now = new Date();
    const { current, previous, brief, move } = await this.decide(request, now);
    const undelivered =
      previous && request.carryMessagesSince
        ? undeliveredSince(await this.repository.messages(previous.id), request.carryMessagesSince)
        : [];
    const carrying = {
      request: { ...request, work: workWithUndelivered(request.work, undelivered) },
      carried: (carrierId: string): CarriedMessages | undefined =>
        previous && undelivered.length > 0
          ? { threadId: previous.id, messageIds: undelivered.map(({ id }) => id), carrierId }
          : undefined,
    };
    if (move.move === "resume" && previous?.session) {
      return this.continueIn(previous, carrying, move, brief, now);
    }
    if (previous?.session) await this.forget(previous.session.id);
    // The user's choice is spent on this run, as a message spends it (`beginStageWork`).
    if (previous?.override) {
      await this.change(previous.id, (latest) => chooseOverride(latest, undefined, now));
    }
    return this.startIn(carrying, current, move, brief, now);
  }

  /**
   * What `open` would decide for the Stage's session now, opening nothing: for what the all clear
   * shows will resume (spec §2.8).
   */
  async sessionAhead(request: StageSessionRequest): Promise<StageSessionAhead> {
    const { brief, move } = await this.decide(request, new Date());
    return {
      move: move.move,
      cacheWarm: move.cacheWarm,
      contextTokens: move.contextTokens,
      briefTokens: brief.tokens,
    };
  }

  /**
   * The Context policy's move for the Stage's session (spec §2.5): going on in its Thread, the
   * Stage takes the user's choice in that Thread's context label, which Resume's label shows; at a
   * Stage boundary the declared session wins.
   */
  private async decide(
    request: StageSessionRequest,
    now: Date,
  ): Promise<{
    readonly current: SessionRole;
    readonly previous: Thread | undefined;
    readonly brief: Brief;
    readonly move: ContextDecision;
  }> {
    const current = await this.roleCards.forNewSession(request.roleKey);
    const previous = await this.previousThread(request.previousThreadId);
    const brief = taskThreadBrief({
      record: request.record,
      continuing: false,
      answered: await this.repository.answeredOn(request.taskId),
      open: undefined,
      memory: await this.memory.forBrief(request.roleKey, {
        kind: "project",
        projectId: request.projectId,
      }),
    });
    const move = decideContext(
      {
        now,
        session: previous?.session,
        roleKey: request.roleKey,
        sessionDefault: current.card.sessionDefault,
        engine: current.card.engine,
        override: request.declared === undefined ? previous?.override : undefined,
        declared: request.declared,
        briefTokens: brief.tokens,
      },
      await this.settings.current(),
    );
    return { current, previous, brief, move };
  }

  /**
   * The user writes into a Stage Thread while its Stage runs (barge-in, spec §2.4): the message is
   * logged waiting, and marked delivered once a turn of the person's has taken it. Refused once
   * the Stage's session has ended.
   */
  async bargeIn(threadId: string, text: string): Promise<Thread> {
    if (text.trim() === "") throw new ThreadRefused(["Write a message first."]);
    const bargeIns = this.bargeIns.get(threadId);
    if (!bargeIns) throw new ThreadRefused([STAGE_ENDING]);
    const said = { id: randomUUID(), text };
    const thread = await this.change(threadId, (latest) =>
      bargeIn(latest, { ...said, at: new Date() }),
    );
    if (!bargeIns.take(said)) await this.mark(threadId, [said.id], "not-delivered");
    return thread;
  }

  /**
   * Ends the Stage's work in a Thread whose session The Office lost as it stopped, found as it
   * starts again (spec §2.4): the user's messages still waiting to land never will, so they are
   * marked not delivered and go with the Stage's next run as after a Stop, and the Thread closes
   * with why the Stage ended. Returns the Decision the person opened since the run `began`, answered
   * or not, for the run to keep.
   */
  async endLeftRunning(
    threadId: string,
    closing: StageWorkClosing,
    began: Date,
  ): Promise<AskedDecision | undefined> {
    await this.mark(
      threadId,
      waitingMessageIds(await this.repository.messages(threadId)),
      "not-delivered",
    );
    await this.change(threadId, (latest) =>
      endStageWork(
        latest,
        { roleKey: latest.roleKey, handoverNote: undefined, closing },
        new Date(),
      ),
    );
    return this.askedIn(threadId, began);
  }

  /**
   * The person's own latest Decision in the Thread, when they opened it since `began`, answered or
   * not: the user may answer it while the Stage still runs, and the Pipeline then reads the answer
   * as the run keeps it.
   */
  private async askedIn(threadId: string, began: Date): Promise<AskedDecision | undefined> {
    const asked = (await this.repository.decisionsIn(threadId)).findLast(
      ({ roleKey, askedAt }) => roleKey !== undefined && askedAt >= began,
    );
    if (!asked) return undefined;
    const { id, question, context, options, recommendation } = asked;
    return { id, question, context, options, recommendation };
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
    { request, carried }: Carrying,
    move: ContextDecision,
    brief: Brief,
    now: Date,
  ): Promise<StageThread> {
    const session = previous.session;
    if (!session) throw new Error(`Thread ${previous.id} has no session to continue.`);
    const role = await this.roleCards.forResumedSession(session.roleKey, session.cardVersion);
    await this.change(previous.id, (latest) =>
      beginStageWork(
        latest,
        { personName: role.card.name, decision: move, newSession: undefined, brief: brief.text },
        now,
      ),
    );
    let leftOut: readonly LeftOutMcpServer[] = [];
    const opened = await this.opening(previous.id, undefined, async () => {
      const skills = await this.sessionSkills.rebuild(session.id);
      const servers = await this.sessionMcpServers.rebuild(session.id, request.folder);
      leftOut = servers.leftOut;
      return this.engine.resume(
        session.id,
        this.settingsOf(previous.id, session, request, role, skills, servers.servers),
      );
    });
    const work = { id: randomUUID(), text: request.work };
    opened.send({ ...work, text: withLeftOutServers(work.text, leftOut) }, "later");
    return this.live(
      {
        threadId: previous.id,
        roleKey: role.roleKey,
        engine: session.engine,
        folder: request.folder,
        began: now,
      },
      move,
      opened,
      carried(work.id),
    );
  }

  /** A new Stage Thread, whose new session starts with the Brief and the Stage's work. */
  private async startIn(
    { request, carried }: Carrying,
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
        // As the planning Thread's "Planning": the web adds the person, as "Implement · Ada".
        title: request.stageName,
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
    const briefId = randomUUID();
    const opened = await this.opening(thread.id, session.id, async () => {
      const skills = await this.sessionSkills.prepare({
        sessionId: session.id,
        roleKey: role.roleKey,
        project: { folder: request.folder, useProjectSkills: request.useProjectSkills },
      });
      const servers = await this.sessionMcpServers.prepare({
        sessionId: session.id,
        roleKey: role.roleKey,
        projectId: request.projectId,
        workingFolder: request.folder,
      });
      return this.engine.start({
        id: session.id,
        settings: this.settingsOf(thread.id, session, request, role, skills, servers.servers),
        brief: {
          id: briefId,
          text: withLeftOutServers(openingMessage(brief.text, request.work), servers.leftOut),
        },
      });
    });
    return this.live(
      {
        threadId: thread.id,
        roleKey: role.roleKey,
        engine: session.engine,
        folder: request.folder,
        began: now,
      },
      move,
      opened,
      carried(briefId),
    );
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
    { id, engine }: ThreadSession,
    request: StageThreadRequest,
    { roleKey, card }: SessionRole,
    skills: Awaited<ReturnType<SessionSkills["prepare"]>>,
    mcpServers: SessionSettings["mcpServers"],
  ): SessionSettings {
    return {
      engine,
      folder: request.folder,
      environment: request.environment,
      model: request.model ?? card.model,
      effort: request.effort ?? card.effort,
      instructions: workThreadInstructions(card, request.session.instructions),
      skills: {
        folder: skills.folder,
        names: skills.names,
        expected: skills.expected,
        overrides: skills.overrides,
      },
      profile: {
        ...request.session.profile,
        mcpTools: mcpToolSettingsFor(request.session.profile.mcpTools, mcpServers),
      },
      officeTools: sessionOfficeTools(
        [...request.session.officeTools, ...roleOfficeTools(roleKey)],
        card,
        true,
      ),
      mcpServers,
      outputSchema: request.session.outputSchema,
      approvalHold: this.approvalHolds.of(id),
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

  /**
   * The Stage's session at work in its Thread. The user's messages its work carries are waiting
   * again, and delivered once a turn has taken the work, as a barge-in is.
   */
  private async live(
    { threadId, roleKey, engine, folder, began }: StageWorkPlace,
    move: ContextDecision,
    session: EngineSession,
    carried: CarriedMessages | undefined,
  ): Promise<StageThread> {
    let carrying = carried;
    if (carrying) await this.mark(carrying.threadId, carrying.messageIds, "waiting");
    const events = session.events[Symbol.asyncIterator]();
    const logger = { roleKey, folder, handingOver: false };
    const bargeIns = new BargeIns((message) => session.send(message, "next"));
    this.bargeIns.set(threadId, bargeIns);
    let turnRunning = true;
    // A turn ended before the user's message landed is followed by one the engine starts with
    // it: the Stage reads that one, with the tokens of both.
    const nextTurn = async (): Promise<StageTurn> => {
      let earlierTokens = NO_TOKENS;
      for (;;) {
        const next = await events.next();
        if (next.done) throw new Error("The session ended before the Stage's turn did.");
        if (next.value.kind === "turn-ended") {
          const turn = await this.turnEnded(threadId, session, next.value);
          const { delivered, stillToLand } = bargeIns.turnEnded(
            next.value.consumedMessageIds,
            next.value.outcome === "completed",
          );
          await this.mark(threadId, delivered, "delivered");
          if (carrying && next.value.consumedMessageIds.includes(carrying.carrierId)) {
            await this.mark(carrying.threadId, carrying.messageIds, "delivered");
            carrying = undefined;
          }
          if (!stillToLand) {
            turnRunning = false;
            return { ...turn, tokens: addTokens(earlierTokens, turn.tokens) };
          }
          earlierTokens = addTokens(earlierTokens, turn.tokens);
          continue;
        }
        if (next.value.kind === "turn-tokens") {
          const { soFar } = next.value;
          await this.change(threadId, (thread) => countRunningTurn(thread, soFar, new Date()));
          continue;
        }
        const lines = sessionLogLines(next.value, logger);
        if (lines.length > 0) await this.log(threadId, lines);
      }
    };
    let sessionEnded: Promise<void> | undefined;
    // The engine ends what the session left running as the session ends.
    const endSession = (): Promise<void> => {
      sessionEnded ??= (async () => {
        this.bargeIns.delete(threadId);
        await this.mark(threadId, bargeIns.end(), "not-delivered");
        if (carrying) await this.mark(carrying.threadId, carrying.messageIds, "not-delivered");
        carrying = undefined;
        await session.end().catch((error: unknown) => {
          this.logger.warn(`Thread ${threadId}'s session didn't end cleanly: ${messageOf(error)}`);
        });
      })();
      return sessionEnded;
    };
    return {
      threadId,
      move,
      nextTurn,
      askedDecision: () => this.askedIn(threadId, began),
      send: async (text, why) => {
        await this.log(threadId, [{ kind: "failure", reason: why }]);
        session.send({ id: randomUUID(), text }, "later");
        turnRunning = true;
        bargeIns.turnStarted();
        return nextTurn();
      },
      interrupt: async () => {
        if (!turnRunning || sessionEnded) return;
        if (!this.engine.capabilitiesOf(engine).interrupt) return endSession();
        await session.interrupt().catch(async (error: unknown) => {
          this.logger.warn(`Thread ${threadId}'s turn wasn't interrupted: ${messageOf(error)}`);
          await endSession();
        });
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

  /**
   * A session that won't be resumed: its skills folder and its MCP servers' record go, and a
   * failure there only warns.
   */
  private async forget(sessionId: string): Promise<void> {
    await this.sessionSkills.forget(sessionId).catch((error: unknown) => {
      this.logger.warn(`Session ${sessionId}'s skills stay: ${messageOf(error)}`);
    });
    await this.sessionMcpServers.forget(sessionId).catch((error: unknown) => {
      this.logger.warn(`Session ${sessionId}'s MCP servers stay recorded: ${messageOf(error)}`);
    });
  }

  private async mark(
    threadId: string,
    messageIds: readonly string[],
    delivery: MessageDelivery,
  ): Promise<void> {
    await this.change(threadId, (thread) =>
      markDelivery(thread, { messageIds, delivery }, new Date()),
    );
  }

  private async log(threadId: string, drafts: readonly MessageDraft[]): Promise<void> {
    const at = new Date();
    const messages = drafts.map((draft): Message => ({ ...draft, id: randomUUID(), threadId, at }));
    await this.change(threadId, (thread) => logMessages(thread, messages, at));
  }

  private async change<Event extends DomainEvent>(
    threadId: string,
    change: (thread: Thread) => ThreadChange<Event> | undefined,
  ): Promise<Thread> {
    const { thread, event } = await this.repository.update(threadId, change);
    if (event) await this.events.publish(event);
    return thread;
  }
}

/**
 * Where a Stage's work goes on: its Thread, its person, the engine their session runs on and
 * their folder, since `began`.
 */
interface StageWorkPlace {
  readonly threadId: string;
  readonly roleKey: string;
  readonly engine: Engine;
  readonly folder: string;
  readonly began: Date;
}

/** A Stage's request with its work carrying the user's undelivered messages, if any. */
interface Carrying {
  readonly request: StageThreadRequest;
  readonly carried: (carrierId: string) => CarriedMessages | undefined;
}

const STAGE_ENDING = "The Stage is ending. Send your message once it has ended.";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
