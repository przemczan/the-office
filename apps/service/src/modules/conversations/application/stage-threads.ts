import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import { AsyncChannel } from "../../../platform/streams/async-channel.js";
import {
  EngineModels,
  EngineSessions,
  engineThroughStandIns,
  type Effort,
  type EngineId,
  type EngineModel,
  type UsageWindowName,
} from "../../engine/index.js";
import { SessionMcpServers, type LeftOutMcpServer } from "../../mcp-servers/index.js";
import { PromptTemplates, type PromptTexts } from "../../prompt-templates/index.js";
import {
  Duties,
  EngineCascade,
  mcpToolSettingsFor,
  RoleCards,
  type McpToolSettings,
  type SessionRole,
} from "../../people/index.js";
import { ApprovalHolds } from "./approval-holds.js";
import { SessionSkills } from "../../skills/index.js";
import { taskThreadBrief, type Brief } from "../domain/brief.js";
import { BRIEF_TEMPLATES } from "../domain/brief-templates.js";
import {
  decideContext,
  DEFAULT_CONTEXT_POLICY_SETTINGS,
  type ContextDecision,
} from "../domain/context-policy.js";
import {
  limitReached,
  stageLimitsWithin,
  type StageContextLimit,
  type StageContextLimits,
} from "../domain/stage-context-limits.js";
import { decisionSummary, onlyChoice, type Recommendation } from "../domain/decision.js";
import type {
  Message,
  MessageDelivery,
  MessageDraft,
  MessageImage,
  StageWorkClosing,
} from "../domain/message.js";
import { SessionMemory } from "./session-memory.js";
import {
  messageFromUser,
  openingMessage,
  withLeftOutServers,
  roleOfficeTools,
  sessionOfficeTools,
  stageCapabilityOfficeTools,
  type HeldDuties,
  type SessionPerson,
} from "../domain/session-instructions.js";
import {
  SESSION_INSTRUCTION_TEMPLATES,
  STAGE_HARD_LIMIT,
  STAGE_SOFT_LIMIT,
  stageLimitMessage,
  workThreadInstructions,
} from "../domain/session-instruction-templates.js";
import {
  addTokens,
  NO_TOKENS,
  type SessionStandIn,
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
  moveSessionBack,
  readRunningContext,
  restartStageSession,
  startStageThread,
  type StageWorkEnding,
  type ThreadChange,
} from "../domain/thread-changes.js";
import { ThreadNotFound } from "../domain/thread-not-found.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import { SwitchFailed } from "../domain/switch-failed.js";
import type { UserRef } from "../domain/user.js";
import {
  undeliveredSince,
  waitingMessageIds,
  workWithUndelivered,
} from "../domain/undelivered-messages.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { BargeIns } from "./barge-ins.js";
import { ThreadImages, type MessageImageContent } from "./thread-images.js";
import { sessionLogLines, type SessionEvent } from "./session-log.js";
import { SessionStartWatch } from "./session-start-watch.js";
import { carrySessionToEngine, type SessionCarrying } from "./session-carry.js";
import { SubAgentsAndProcesses, type FollowedSession } from "./sub-agents-and-processes.js";
import { ContextPolicySettingsService } from "./context-policy-settings.js";
import { OfficeInstructions } from "./office-instructions.js";
import { ProjectOutputMasks, type TextMask } from "../ports/project-output-masks.js";

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
  /** The Task's Initiative; undefined when the Task is in none. */
  readonly initiativeId: string | undefined;
  /** The Stage run's number, as the Task's Stage history counts them. */
  readonly stageRun: number;
  /** The Task's Pipeline's name, and its Project's, which the session's telemetry carries. */
  readonly pipelineName: string;
  readonly projectName: string;
  /** The Stage's own effort, the model and effort cascade's most specific level; undefined for none. */
  readonly effort: Effort | undefined;
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
  readonly projectSkillsOff: readonly string[];
  readonly session: StageSessionSettings;
  /**
   * The Stand-in Engines the Task's Start chose, each for a cascade's engine: the Stage Thread's
   * session runs on the stand-in while it is listed and serves the cascade's model.
   */
  readonly engineStandIns: readonly StageThreadStandIn[];
  /**
   * The Stage's context limits, its own or the Office defaults (spec §2.5); undefined for No limit.
   * The Thread caps them at the share of the model's window where a chat hands over.
   */
  readonly contextLimits: StageContextLimits | undefined;
}

/** A Stand-in Engine chosen at the Task's Start for the cascade's engine `engineId`, and why. */
export interface StageThreadStandIn {
  readonly engineId: EngineId;
  readonly standInId: EngineId;
  /** The cascade's engine's name as Start recorded it. */
  readonly engineName: string;
  readonly reason: string;
}

/** What decides a Stage's session: who works it, after which Thread, and the Brief's record. */
type StageSessionRequest = Pick<
  StageThreadRequest,
  "taskId" | "projectId" | "roleKey" | "declared" | "previousThreadId" | "record" | "engineStandIns"
> &
  Partial<Pick<StageThreadRequest, "effort">>;

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
  /** The session's context after the turn; undefined when its engine can't report it. */
  readonly context: StageTurnContext | undefined;
  /** Set when the engine refused the turn as a usage window is used up: which, and its reset. */
  readonly usedUpWindow?: { readonly window: string; readonly resetsAt: Date };
}

/** A session's context after a turn, against its model's window. */
export interface StageTurnContext {
  readonly tokens: number;
  readonly window: number;
}

/**
 * A Decision the person asked in a Stage Thread, with the id it is answered by, as the Pipeline
 * keeps it: the Decision in one line, and its options and recommendation when it is exactly one
 * choice, none otherwise.
 */
export interface AskedDecision {
  readonly id: string;
  readonly question: string;
  readonly context: string;
  readonly options: readonly string[];
  readonly recommendation: Recommendation;
}

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
  /**
   * The engine the session runs on now, by its id, which `switchTo` changes, and the model, by its
   * id there, which it keeps.
   */
  readonly engine: EngineId;
  readonly model: string;
  /** The engine the session's Stand-in Engine runs for now; undefined on the cascade's. */
  readonly standInFor?: SessionStandIn;
  /** The person's turn running now, as it ends. */
  nextTurn(): Promise<StageTurn>;
  /** The session's context: the last turn's reading, else the Thread session's; 0 with none. */
  contextTokens(): number;
  /**
   * Goes on with the session, idle after its engine refused a turn for the used-up window `why`, on
   * the Stand-in Engine `standIn` with the same model (spec 5.4): the session is carried over to it
   * and resumed there, the Thread logs an `engine-switched` line, and the user's messages still to
   * land go with the next turn. Throws `SwitchFailed` when it couldn't be carried over or resumed;
   * the Thread then stays on the engine it ran on, where its session resumes later.
   */
  switchTo(
    standIn: EngineModel,
    why: { readonly window: UsageWindowName; readonly resetsAt: Date },
  ): Promise<void>;
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
  /**
   * The context limit the session passed, past which The Office asked the person for a Handover
   * note (spec §2.5): the hard one once both; undefined while it passed none, and again after
   * `restart`.
   */
  contextLimitPassed(): StageContextLimit | undefined;
  /**
   * Ends the session and goes on in a fresh one in the same Thread (spec §2.5): logs the restart
   * with the ended session's context and whether `handoverNote` was passed on, and starts the
   * person's turn with a Brief of the Task's `record`, made as a Stage's first session's is, then
   * `work`; `nextTurn` then reads it. The Thread's waiting messages and the Stage's work in it carry
   * on. Returns the message the fresh session started with.
   */
  restart(
    fresh: { readonly record: string; readonly work: string },
    handoverNote: string | undefined,
  ): Promise<string>;
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
    private readonly engineCascade: EngineCascade,
    private readonly engine: EngineSessions,
    private readonly sessionSkills: SessionSkills,
    private readonly sessionMcpServers: SessionMcpServers,
    private readonly events: EventBus,
    private readonly settings: ContextPolicySettingsService,
    private readonly memory: SessionMemory,
    private readonly approvalHolds: ApprovalHolds,
    private readonly officeInstructions: OfficeInstructions,
    private readonly masks: ProjectOutputMasks,
    private readonly subAgentsAndProcesses: SubAgentsAndProcesses,
    private readonly duties: Duties,
    private readonly schedule: Schedule,
    private readonly images: ThreadImages,
    private readonly engineModels: EngineModels,
    private readonly promptTemplates: PromptTemplates,
  ) {}

  /** Throws RoleNotFound when nobody fills the Stage's Role. */
  async open(request: StageThreadRequest): Promise<StageThread> {
    const now = new Date();
    const { current, held, applying, standInFor, previous, brief, move, prompts } =
      await this.decide(request, now);
    const undelivered =
      previous && request.carryMessagesSince
        ? undeliveredSince(await this.repository.messages(previous.id), request.carryMessagesSince)
        : [];
    const carrying = {
      request: { ...request, work: workWithUndelivered(request.work, undelivered) },
      images: await this.images.contents(undelivered.flatMap(({ images = [] }) => images)),
      carried: (carrierId: string): CarriedMessages | undefined =>
        previous && undelivered.length > 0
          ? { threadId: previous.id, messageIds: undelivered.map(({ id }) => id), carrierId }
          : undefined,
    };
    if (move.move === "resume" && previous?.session) {
      return this.continueIn(
        previous,
        carrying,
        { held, applying, standInFor, move, brief, prompts },
        now,
      );
    }
    if (previous?.session) await this.forget(previous.session.id);
    // The user's choice is spent on this run, as a message spends it (`beginStageWork`).
    if (previous?.override) {
      await this.change(previous.id, (latest) => chooseOverride(latest, undefined, now));
    }
    return this.startIn(
      carrying,
      current,
      { held, applying, standInFor, move, brief, prompts },
      now,
    );
  }

  /**
   * What `open` would decide for the Stage's session now, opening nothing: for what the all clear
   * shows will resume (spec §2.8).
   */
  async taskInSession(sessionId: string): Promise<string | undefined> {
    const home = (await this.repository.findBySession(sessionId))?.home;
    return home?.kind === "task" ? home.taskId : undefined;
  }

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
   * Stage boundary the declared session wins. The engine and model come from the engine cascade
   * resolved for the Task (its own engine override, its Initiative's, its Project's and the
   * Office's levels); a changed engine starts the session fresh, a changed model alone resumes it.
   */
  private async decide(
    request: StageSessionRequest,
    now: Date,
  ): Promise<
    StageSessionDecision & {
      readonly current: SessionRole;
      readonly previous: Thread | undefined;
    }
  > {
    const current = await this.roleCards.forNewSession(request.roleKey);
    const held = await this.duties.heldBy(request.roleKey);
    const location = { projectId: request.projectId, taskId: request.taskId };
    const work = { stageEffort: request.effort };
    const cascade = await this.engineCascade.of(request.roleKey, location, work);
    // Mapped before the Context policy compares it with the session's engine, so a session is
    // never resumed on another engine; a stand-in removed since, or no longer in the list that
    // applies, gives the cascade's back. Under an engine override no list applies (spec §5.4.6),
    // so an override turned on while the Task ran on a stand-in starts the next Stage fresh on it.
    const through = engineThroughStandIns(
      cascade.engineId,
      request.engineStandIns,
      await this.engineModels.engines(),
      cascade.standIns.engineIds,
    );
    // On a Stand-in Engine, of the same type or another, the person works with their model and
    // effort for its type.
    const landed =
      through === cascade.engineId
        ? cascade
        : await this.engineCascade.onEngine(request.roleKey, through, location, work);
    const applying: StageEngine = {
      engineId: landed.engineId,
      model: landed.model,
      effort: landed.effort,
      // A model giving way is logged only on the cascade's own engine, never on a stand-in.
      ...(through === cascade.engineId &&
        cascade.gaveWay !== undefined && { gaveWay: cascade.gaveWay }),
    };
    const standIn =
      applying.engineId === cascade.engineId
        ? undefined
        : request.engineStandIns.find(({ engineId }) => engineId === cascade.engineId);
    const standInFor: SessionStandIn | undefined = standIn && {
      engineId: standIn.engineId,
      engineName: standIn.engineName,
      reason: standIn.reason,
    };
    const previous = await this.previousThread(request.previousThreadId);
    const prompts = await this.promptTemplates.textsOf([
      ...BRIEF_TEMPLATES,
      ...SESSION_INSTRUCTION_TEMPLATES,
    ]);
    const brief = taskThreadBrief(prompts, {
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
        engineId: applying.engineId,
        forced: cascade.standIns.from === "none",
        override: request.declared === undefined ? previous?.override : undefined,
        declared: request.declared,
        briefTokens: brief.tokens,
        heldDuties: held,
      },
      await this.settings.current(),
    );
    return { current, held, applying, standInFor, previous, brief, move, prompts };
  }

  /**
   * The user writes into a Stage Thread while its Stage runs (barge-in, spec §2.4): the message is
   * logged waiting, with the user who wrote it, and marked delivered once a turn of the person's
   * has taken it; the person reads who wrote it unless the same user wrote the one before in this
   * Stage's session. Refused once the Stage's session has ended.
   */
  async bargeIn(
    threadId: string,
    text: string,
    writtenBy: UserRef,
    images: readonly MessageImage[] = [],
  ): Promise<Thread> {
    if (text.trim() === "" && images.length === 0) {
      throw new ThreadRefused(["Write a message first."]);
    }
    const bargeIns = this.bargeIns.get(threadId);
    if (!bargeIns) throw new ThreadRefused([STAGE_ENDING]);
    const contents = await this.images.contents(images);
    const id = randomUUID();
    const thread = await this.change(threadId, (latest) =>
      bargeIn(latest, { id, text, writtenBy, at: new Date(), images }),
    );
    const said = {
      id,
      text: messageFromUser(text, writtenBy, bargeIns.writerBefore(writtenBy)),
      ...(contents.length > 0 && { images: contents }),
    };
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
    const choice = onlyChoice(asked);
    return {
      id: asked.id,
      question: decisionSummary(asked),
      context: asked.context,
      options: choice?.options ?? [],
      recommendation: choice?.recommendation ?? { option: 0, reason: "" },
    };
  }

  private async previousThread(id: string | undefined): Promise<Thread | undefined> {
    if (id === undefined) return undefined;
    const thread = await this.repository.find(id);
    if (!thread) throw new ThreadNotFound(id);
    return thread;
  }

  /**
   * The previous Stage's session goes on in its Thread, given the Stage's work alone, on its own
   * engine and the model the cascade gives now.
   */
  private async continueIn(
    previous: Thread,
    { request, images, carried }: Carrying,
    { held, applying, move, brief }: StageSessionDecision,
    now: Date,
  ): Promise<StageThread> {
    const session = previous.session;
    if (!session) throw new Error(`Thread ${previous.id} has no session to continue.`);
    const role = await this.roleCards.forResumedSession(session.roleKey, session.cardVersion);
    const office = await this.officeInstructions.forResumedSession(
      session.officeInstructionsVersion,
    );
    const person = { ...role, officeInstructions: office.text };
    const contextLimits = await this.contextLimitsOn(session.engineId, request.contextLimits);
    await this.change(previous.id, (latest) =>
      beginStageWork(
        latest,
        {
          personName: role.card.name,
          decision: move,
          newSession: undefined,
          brief: brief.text,
          contextLimits,
        },
        now,
      ),
    );
    const start = this.startWatch(previous.id, session, role.card.name, "resume");
    const reopening: Reopening = {
      threadId: previous.id,
      request,
      person,
      held,
      effort: applying.effort,
    };
    const { opened, canInterrupt, leftOut } = await this.opening(
      start,
      previous.id,
      undefined,
      () => this.reopen(session, reopening, applying, start),
    );
    await this.sayModelGaveWay(previous.id, role.card.name, applying);
    const work = { id: randomUUID(), text: request.work };
    opened.send(
      {
        ...work,
        text: withLeftOutServers(work.text, leftOut),
        ...(images.length > 0 && { images }),
      },
      "later",
    );
    return this.live(
      {
        threadId: previous.id,
        roleKey: role.roleKey,
        personName: role.card.name,
        engine: session.engineId,
        // A continued session stays on its engine, as it started: a stand-in or the cascade's.
        standInFor: session.standInFor,
        canInterrupt,
        contextTokens: session.contextTokens,
        contextLimits,
        contextWindow: session.contextWindow,
        reopening,
        model: applying.model,
        folder: request.folder,
        mask: await this.masks.outputMaskOf(request.projectId),
        taskId: request.taskId,
        began: now,
        subAgentsLabel: `${role.card.name}'s Sub-agents in the Stage ${request.stageName}`,
      },
      move,
      opened,
      start,
      carried(work.id),
    );
  }

  /** A new Stage Thread, whose new session starts with the Brief and the Stage's work. */
  private async startIn(
    { request, images, carried }: Carrying,
    role: SessionRole,
    { held, applying, standInFor, move, brief, prompts }: StageSessionDecision,
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
    const contextLimits = await this.contextLimitsOn(applying.engineId, request.contextLimits);
    const started = await this.startSession(
      { threadId: thread.id, request, role, held, applying, standInFor, prompts },
      (session) =>
        this.change(thread.id, (latest) =>
          beginStageWork(
            latest,
            {
              personName: role.card.name,
              decision: move,
              newSession: session,
              brief: brief.text,
              contextLimits,
            },
            now,
          ),
        ),
      { text: openingMessage(brief.text, request.work), images },
      now,
    );
    await this.sayModelGaveWay(thread.id, role.card.name, applying);
    return this.live(
      {
        threadId: thread.id,
        roleKey: role.roleKey,
        personName: role.card.name,
        engine: applying.engineId,
        standInFor,
        canInterrupt: started.canInterrupt,
        contextTokens: 0,
        contextLimits,
        contextWindow: undefined,
        reopening: started.reopening,
        model: applying.model,
        folder: request.folder,
        mask: await this.masks.outputMaskOf(request.projectId),
        taskId: request.taskId,
        began: now,
        subAgentsLabel: `${role.card.name}'s Sub-agents in the Stage ${request.stageName}`,
      },
      move,
      started.opened,
      started.start,
      carried(started.firstMessageId),
    );
  }

  /**
   * Opens a new session for the person in the Stage Thread, on the engine `applying` gives, with
   * the current Office instructions: `record` keeps it on the Thread first, then the session starts
   * with `first`, as a new Stage Thread's does with its Brief and a restarted one with the Brief
   * Pipelines gives.
   */
  private async startSession(
    {
      threadId,
      request,
      role,
      held,
      applying,
      standInFor,
      prompts,
    }: Pick<StageSessionDecision, "held" | "applying" | "standInFor" | "prompts"> & {
      readonly threadId: string;
      readonly request: StageThreadRequest;
      readonly role: SessionRole;
    },
    record: (session: ThreadSession) => Promise<unknown>,
    first: { readonly text: string; readonly images: readonly MessageImageContent[] },
    now: Date,
  ): Promise<StartedSession> {
    const office = await this.officeInstructions.current();
    const session = freshSession(
      randomUUID(),
      {
        ...role,
        officeInstructionsVersion: office.version,
        engineId: applying.engineId,
        changesAllowed: false,
        heldDuties: held,
        standInFor,
      },
      now,
    );
    await record(session);
    const firstMessageId = randomUUID();
    const person = { ...role, officeInstructions: office.text };
    let canInterrupt = false;
    const start = this.startWatch(threadId, session, role.card.name, "start");
    const opened = await this.opening(start, threadId, session.id, async () => {
      canInterrupt = (await this.engine.capabilitiesOf(applying.engineId)).interrupt;
      start.at("preparing skills");
      const skills = await this.sessionSkills.prepare({
        sessionId: session.id,
        roleKey: role.roleKey,
        project: {
          id: request.projectId,
          folder: request.folder,
          useProjectSkills: request.useProjectSkills,
          projectSkillsOff: request.projectSkillsOff,
        },
      });
      start.at("preparing MCP servers");
      const servers = await this.sessionMcpServers.prepare({
        sessionId: session.id,
        roleKey: role.roleKey,
        projectId: request.projectId,
        workingFolder: request.folder,
      });
      start.at("starting on the engine");
      return this.engine.start({
        id: session.id,
        settings: this.settingsOf(
          prompts,
          threadId,
          session,
          request,
          person,
          held,
          applying,
          applying.effort,
          skills,
          servers.servers,
        ),
        brief: {
          id: firstMessageId,
          text: withLeftOutServers(first.text, servers.leftOut),
          ...(first.images.length > 0 && { images: first.images }),
        },
      });
    });
    return {
      opened,
      canInterrupt,
      start,
      firstMessageId,
      reopening: { threadId, request, person, held, effort: applying.effort },
    };
  }

  /**
   * The Thread's line saying the person works with the engine's default model, as the model a level
   * of the cascade set isn't offered there (spec §5.4.5); nothing when none gave way.
   */
  private async sayModelGaveWay(
    threadId: string,
    personName: string,
    { engineId, model, gaveWay }: StageEngine,
  ): Promise<void> {
    if (gaveWay === undefined) return;
    await this.log(threadId, [
      {
        kind: "model-gave-way",
        personName,
        model,
        engineName: await this.engine.nameOf(engineId),
        notOffered: gaveWay,
      },
    ]);
  }

  /** The Stage's context limits on `engineId`: none on an engine that doesn't report its context. */
  private async contextLimitsOn(
    engineId: EngineId,
    limits: StageContextLimits | undefined,
  ): Promise<StageContextLimits | undefined> {
    return limits && (await this.engine.reportsContext(engineId)) ? limits : undefined;
  }

  /** Writes the opening of the Stage Thread's session into the service log. */
  private startWatch(
    threadId: string,
    { id, engineId }: ThreadSession,
    personName: string,
    move: "start" | "resume",
  ): SessionStartWatch {
    const start = new SessionStartWatch(
      { threadId, sessionId: id, engineId, personName, move },
      this.schedule,
      this.logger,
    );
    // A Stage's session waits for no other, and the Task's worktree needs no refresh.
    start.at("preparing skills");
    return start;
  }

  /**
   * Opens the session, or logs why it didn't open and the Thread waits: a new session that never
   * ran gives way to none, and its skills go.
   */
  private async opening<Opened>(
    start: SessionStartWatch,
    threadId: string,
    newSessionId: string | undefined,
    open: () => Promise<Opened>,
  ): Promise<Opened> {
    try {
      const opened = await open();
      start.at("waiting for the engine's first event");
      return opened;
    } catch (error) {
      start.failed(error);
      const unopened =
        newSessionId === undefined ? undefined : { sessionId: newSessionId, previous: undefined };
      await this.change(threadId, (latest) =>
        failAnswer(latest, messageOf(error), new Date(), unopened),
      );
      if (newSessionId) await this.forget(newSessionId);
      throw error;
    }
  }

  /**
   * Resumes the Thread's session on its engine, `session.engineId`, with the model `applying` gives,
   * its skills and MCP servers rebuilt: as a Stage goes on in the Thread, or on a Stand-in Engine.
   */
  private async reopen(
    session: ThreadSession,
    { threadId, request, person, held, effort }: Reopening,
    applying: EngineModel,
    start: SessionStartWatch,
  ): Promise<Reopened> {
    const canInterrupt = (await this.engine.capabilitiesOf(session.engineId)).interrupt;
    // Loaded again, as a Stand-in switch resumes a session long after the Stage opened it.
    const prompts = await this.promptTemplates.textsOf(SESSION_INSTRUCTION_TEMPLATES);
    start.at("preparing skills");
    const skills = await this.sessionSkills.rebuild(session.id);
    start.at("preparing MCP servers");
    const servers = await this.sessionMcpServers.rebuild(session.id, request.folder);
    start.at("starting on the engine");
    const opened = await this.engine.resume(
      session.id,
      this.settingsOf(
        prompts,
        threadId,
        session,
        request,
        person,
        held,
        applying,
        effort,
        skills,
        servers.servers,
      ),
    );
    return { opened, canInterrupt, leftOut: servers.leftOut };
  }

  private settingsOf(
    prompts: PromptTexts,
    threadId: string,
    { id, engineId }: ThreadSession,
    request: StageThreadRequest,
    {
      roleKey,
      card,
      mcpToolDefault,
      officeInstructions,
    }: SessionRole & Pick<SessionPerson, "officeInstructions">,
    held: HeldDuties,
    applying: EngineModel,
    effort: Effort | null,
    skills: Awaited<ReturnType<SessionSkills["prepare"]>>,
    mcpServers: SessionSettings["mcpServers"],
  ): SessionSettings {
    return {
      engineId,
      model: applying.model,
      folder: request.folder,
      environment: request.environment,
      effort: effort ?? undefined,
      instructions: workThreadInstructions(
        prompts,
        { card, officeInstructions },
        request.session.instructions,
      ),
      skills: {
        folder: skills.folder,
        names: skills.names,
        expected: skills.expected,
        userOnly: skills.userOnly,
        overrides: skills.overrides,
      },
      profile: {
        ...request.session.profile,
        mcpTools: mcpToolSettingsFor(request.session.profile.mcpTools, mcpServers, mcpToolDefault),
      },
      officeTools: sessionOfficeTools(
        [
          ...request.session.officeTools,
          ...roleOfficeTools(held),
          ...stageCapabilityOfficeTools(card.capabilities),
        ],
        card,
        true,
      ),
      mcpServers,
      outputSchema: request.session.outputSchema,
      // The end of the turn is the Stage's result, so no Sub-agent may outlive it (spec §2.9).
      subAgentsInForeground: true,
      approvalHold: this.approvalHolds.of(id),
      turnLabel: `${card.name} in the Stage ${request.stageName}`,
      telemetry: stageThreadTelemetry(threadId, roleKey, request),
    };
  }

  /**
   * The Stage's session at work in its Thread. The user's messages its work carries are waiting
   * again, and delivered once a turn has taken the work, as a barge-in is. The engine session is
   * held as it stands now: `switchTo` replaces it with the same session resumed on a Stand-in Engine.
   */
  private async live(
    {
      threadId,
      roleKey,
      personName,
      engine: startedOn,
      standInFor: startedFor,
      canInterrupt: startedInterruptible,
      contextTokens: contextBefore,
      contextLimits,
      contextWindow,
      reopening: openedWith,
      model,
      folder,
      mask,
      taskId,
      began,
      subAgentsLabel,
    }: StageWorkPlace,
    move: ContextDecision,
    opened: EngineSession,
    start: SessionStartWatch,
    carried: CarriedMessages | undefined,
  ): Promise<StageThread> {
    let carrying = carried;
    if (carrying) await this.mark(carrying.threadId, carrying.messageIds, "waiting");
    let session = opened;
    let engine = startedOn;
    let standInFor = startedFor;
    let canInterrupt = startedInterruptible;
    let contextTokens = contextBefore;
    let reopening = openedWith;
    // The context limits the session works under (spec §2.5), capped by its window once known, and
    // the session's latest reading against them.
    let limits = contextLimits;
    let window = contextWindow;
    let latestContext = contextBefore;
    let limitPassed: StageContextLimit | undefined;
    // The Office's own message about a limit, until a turn takes it; a turn ended before it landed
    // is followed by one the engine starts with it.
    let officeMessageId: string | undefined;
    // The turn The Office stopped at the hard limit, until it ends; or the session it ended there,
    // on an engine that can't stop a turn.
    let stoppingAtHardLimit = false;
    let endedAtHardLimit = false;
    // MCP servers a resume on a Stand-in Engine left out, which The Office's next message names.
    let leftOut: readonly LeftOutMcpServer[] = [];
    const followed = (sessionId: string): FollowedSession => ({
      threadId,
      home: { kind: "task", taskId },
      sessionId,
      folder,
      mask,
      subAgentsLabel,
    });
    let reading = this.read(session, followed(session.id), start);
    let events = reading.turnEvents[Symbol.asyncIterator]();
    const logger = { roleKey, folder, handingOver: false, mask };
    const bargeIns = new BargeIns((message) => session.send(message, "next"));
    this.bargeIns.set(threadId, bargeIns);
    let turnRunning = true;
    const effectiveLimits = (): StageContextLimits | undefined =>
      limits && stageLimitsWithin(limits, window, DEFAULT_CONTEXT_POLICY_SETTINGS.handOverAtShare);
    const sendOffice = (text: string, priority: "next" | "later"): void => {
      officeMessageId = randomUUID();
      session.send({ id: officeMessageId, text }, priority);
    };
    const limitMessage = async (passed: StageContextLimit, limit: number): Promise<string> =>
      stageLimitMessage(
        await this.promptTemplates.textsOf([STAGE_SOFT_LIMIT, STAGE_HARD_LIMIT]),
        passed,
        limit,
      );
    // Past the soft limit the person is told once, at the running turn's next safe point, to hand
    // over; past the hard one the turn stops, and the person is asked for the note as it ends.
    const watchLimits = async (tokens: number): Promise<void> => {
      const within = effectiveLimits();
      const passed = within && limitReached(within, tokens);
      if (!within || !passed || passed === limitPassed || limitPassed === "hard") return;
      limitPassed = passed;
      await this.log(threadId, [
        { kind: "stage-context-limit", limit: passed, contextTokens: tokens },
      ]);
      if (passed === "soft") {
        sendOffice(await limitMessage("soft", within.soft), "next");
        return;
      }
      stoppingAtHardLimit = true;
      if (canInterrupt) {
        try {
          await session.interrupt();
          return;
        } catch (error) {
          this.logger.warn(`Thread ${threadId}'s turn wasn't interrupted: ${messageOf(error)}`);
        }
      }
      // The session ends instead: its turn ends with it, and the Stage goes on in a fresh one.
      stoppingAtHardLimit = false;
      endedAtHardLimit = true;
      await closeSession();
    };
    // A turn ended before the user's message landed, or The Office's, is followed by one the engine
    // starts with it: the Stage reads that one, with the tokens of both. So is a turn stopped at the
    // hard limit, by the one answering The Office's ask for the Handover note.
    const nextTurn = async (): Promise<StageTurn> => {
      let earlierTokens = NO_TOKENS;
      for (;;) {
        const next = await events.next();
        if (next.done) {
          if (!endedAtHardLimit) throw new Error("The session ended before the Stage's turn did.");
          turnRunning = false;
          return {
            output: undefined,
            problem: "The session passed its hard context limit and ended.",
            tokens: earlierTokens,
            context: window === undefined ? undefined : { tokens: latestContext, window },
          };
        }
        if (next.value.kind === "turn-ended") {
          const turn = await this.turnEnded(threadId, session, engine, next.value);
          if (turn.context) {
            contextTokens = turn.context.tokens;
            latestContext = turn.context.tokens;
            window = turn.context.window;
          }
          const completed = next.value.outcome === "completed";
          const { delivered, stillToLand } = bargeIns.turnEnded(
            next.value.consumedMessageIds,
            completed,
          );
          await this.mark(threadId, delivered, "delivered");
          if (carrying && next.value.consumedMessageIds.includes(carrying.carrierId)) {
            await this.mark(carrying.threadId, carrying.messageIds, "delivered");
            carrying = undefined;
          }
          if (officeMessageId && next.value.consumedMessageIds.includes(officeMessageId)) {
            officeMessageId = undefined;
          }
          if (stoppingAtHardLimit) {
            stoppingAtHardLimit = false;
            earlierTokens = addTokens(earlierTokens, turn.tokens);
            sendOffice(
              await limitMessage("hard", effectiveLimits()?.hard ?? latestContext),
              "later",
            );
            turnRunning = true;
            bargeIns.turnStarted();
            continue;
          }
          if (!stillToLand && !(completed && officeMessageId)) {
            turnRunning = false;
            officeMessageId = undefined;
            return { ...turn, tokens: addTokens(earlierTokens, turn.tokens) };
          }
          if (!stillToLand) bargeIns.turnStarted();
          earlierTokens = addTokens(earlierTokens, turn.tokens);
          continue;
        }
        if (next.value.kind === "turn-tokens") {
          const { soFar } = next.value;
          await this.change(threadId, (thread) => countRunningTurn(thread, soFar, new Date()));
          continue;
        }
        if (next.value.kind === "context-read") {
          const { tokens } = next.value;
          latestContext = tokens;
          await this.change(threadId, (thread) => readRunningContext(thread, tokens, new Date()));
          await watchLimits(tokens);
          continue;
        }
        const lines = sessionLogLines(next.value, logger);
        if (lines.length > 0) await this.log(threadId, lines);
      }
    };
    // The engine session held now ends once, and with it what it left running.
    let closing: Promise<void> | undefined;
    const closeSession = (): Promise<void> => {
      const ending = session;
      const ended = reading.finished;
      closing ??= (async () => {
        await ending.end().catch((error: unknown) => {
          this.logger.warn(`Thread ${threadId}'s session didn't end cleanly: ${messageOf(error)}`);
        });
        await ended;
      })();
      return closing;
    };
    let sessionEnded: Promise<void> | undefined;
    const endSession = (): Promise<void> => {
      sessionEnded ??= (async () => {
        this.bargeIns.delete(threadId);
        await this.mark(threadId, bargeIns.end(), "not-delivered");
        if (carrying) await this.mark(carrying.threadId, carrying.messageIds, "not-delivered");
        carrying = undefined;
        await closeSession();
      })();
      return sessionEnded;
    };
    const switchTo = async (
      standIn: EngineModel,
      why: { readonly window: UsageWindowName; readonly resetsAt: Date },
    ): Promise<void> => {
      const from = engine;
      const failed = (cause: unknown) => new SwitchFailed(threadId, from, standIn.engineId, cause);
      if (sessionEnded) throw failed(new Error("The Stage's session has ended."));
      const before = { engineId: from, standInFor };
      // Copied, then recorded, then resumed: at a crash in between, the engine the Thread records
      // holds its session.
      let moved: ThreadSession;
      let names: { readonly fromName: string; readonly toName: string };
      try {
        await closeSession();
        ({ session: moved, ...names } = await carrySessionToEngine(
          this.carrying,
          threadId,
          session.id,
          { from, to: standIn.engineId, ...why },
        ));
      } catch (error) {
        throw failed(error);
      }
      const watch = this.startWatch(threadId, moved, personName, "resume");
      let reopened: Reopened;
      try {
        reopened = await this.reopen(moved, reopening, standIn, watch);
        watch.at("waiting for the engine's first event");
      } catch (error) {
        watch.failed(error);
        await this.change(threadId, (latest) =>
          moveSessionBack(latest, { from: standIn.engineId, to: before }, new Date()),
        );
        // The line logged as it moved said it went on there: this one says it didn't.
        await this.log(threadId, [
          {
            kind: "failure",
            reason: `The session didn't resume on ${names.toName}, so it stays on ${names.fromName}: ${messageOf(error)}`,
          },
        ]);
        throw failed(error);
      }
      session = reopened.opened;
      closing = undefined;
      reading = this.read(session, followed(session.id), watch);
      events = reading.turnEvents[Symbol.asyncIterator]();
      engine = standIn.engineId;
      standInFor = moved.standInFor;
      canInterrupt = reopened.canInterrupt;
      leftOut = reopened.leftOut;
      limits = await this.contextLimitsOn(engine, limits);
      // The new session never got what was sent into the old one: it goes with the next turn.
      bargeIns.sessionReplaced();
    };
    const restart = async (
      fresh: { readonly record: string; readonly work: string },
      handoverNote: string | undefined,
    ): Promise<string> => {
      if (sessionEnded) throw new Error("The Stage's session has ended.");
      const ended = { id: session.id, contextTokens: latestContext };
      await closeSession();
      await this.forget(ended.id);
      const { request } = reopening;
      const prompts = await this.promptTemplates.textsOf([
        ...BRIEF_TEMPLATES,
        ...SESSION_INSTRUCTION_TEMPLATES,
      ]);
      // Briefed as the Stage's first session is, with the Memory and answered Decisions as they are now.
      const brief = taskThreadBrief(prompts, {
        record: fresh.record,
        continuing: true,
        answered: await this.repository.answeredOn(request.taskId),
        open: undefined,
        memory: await this.memory.forBrief(roleKey, {
          kind: "project",
          projectId: request.projectId,
        }),
      }).text;
      const first = openingMessage(brief, fresh.work);
      const role = await this.roleCards.forNewSession(roleKey);
      const started = await this.startSession(
        {
          threadId,
          request,
          role,
          held: await this.duties.heldBy(roleKey),
          applying: { engineId: engine, model, effort: reopening.effort },
          standInFor,
          prompts,
        },
        (newSession) =>
          this.change(threadId, (latest) =>
            restartStageSession(
              latest,
              {
                newSession,
                contextTokens: ended.contextTokens,
                handoverNotePassedOn: handoverNote !== undefined,
                brief,
              },
              new Date(),
            ),
          ),
        { text: first, images: [] },
        new Date(),
      );
      session = started.opened;
      closing = undefined;
      reading = this.read(session, followed(session.id), started.start);
      events = reading.turnEvents[Symbol.asyncIterator]();
      canInterrupt = started.canInterrupt;
      reopening = started.reopening;
      leftOut = [];
      contextTokens = 0;
      latestContext = 0;
      // The window stays: the fresh session runs the same model on the same engine.
      limitPassed = undefined;
      officeMessageId = undefined;
      stoppingAtHardLimit = false;
      endedAtHardLimit = false;
      turnRunning = true;
      // What the ended session never took goes into the fresh one's first turn.
      bargeIns.sessionReplaced();
      bargeIns.turnStarted();
      return first;
    };
    return {
      threadId,
      move,
      get engine() {
        return engine;
      },
      model,
      get standInFor() {
        return standInFor;
      },
      nextTurn,
      contextTokens: () => contextTokens,
      contextLimitPassed: () => limitPassed,
      restart,
      switchTo,
      askedDecision: () => this.askedIn(threadId, began),
      send: async (text, why) => {
        await this.log(threadId, [{ kind: "failure", reason: why }]);
        session.send({ id: randomUUID(), text: withLeftOutServers(text, leftOut) }, "later");
        leftOut = [];
        turnRunning = true;
        bargeIns.turnStarted();
        return nextTurn();
      },
      interrupt: async () => {
        if (!turnRunning || sessionEnded) return;
        if (!canInterrupt) return endSession();
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

  /**
   * One reader for the session's whole life: what it reports of its Sub-agents and Processes is kept
   * as it comes, between turns and after the run's last turn too, and every other event waits for
   * the Stage's turn that reads it. `start` hears of its first event.
   */
  private read(
    session: EngineSession,
    followed: FollowedSession,
    start: SessionStartWatch,
  ): { readonly turnEvents: AsyncChannel<SessionEvent>; readonly finished: Promise<void> } {
    const turnEvents = new AsyncChannel<SessionEvent>();
    const following = this.subAgentsAndProcesses.follow(followed);
    const finished = (async () => {
      try {
        for await (const event of session.events) {
          start.spoke();
          await following.take(event);
          if (!BACKGROUND_EVENT_KINDS.has(event.kind)) turnEvents.push(event);
        }
        turnEvents.close();
      } catch (error) {
        start.failed(error);
        turnEvents.fail(error);
      } finally {
        start.ended();
        await following.end();
      }
    })();
    return { turnEvents, finished };
  }

  /** Counts the turn on the Thread, which stays answering until the Stage ends. */
  private async turnEnded(
    threadId: string,
    session: EngineSession,
    engineId: EngineId,
    turn: Extract<SessionEvent, { kind: "turn-ended" }>,
  ): Promise<StageTurn> {
    const problem =
      turn.outcome === "completed"
        ? undefined
        : turn.errors.join(" ") ||
          (turn.outcome === "interrupted"
            ? "The turn was interrupted."
            : "The engine ended the turn.");
    const context = (await this.engine.reportsContext(engineId))
      ? await session.readContextUsage()
      : undefined;
    await this.change(threadId, (thread) =>
      endTurn(thread, {
        usage: turn.usage,
        contextTokens: context?.tokens ?? 0,
        contextWindow: context?.window,
        handingOver: false,
        turnFollows: true,
        endedAt: new Date(),
      }),
    );
    const { usedUpWindow } = turn;
    // The Stage runner holds the run; the line says why, as a notice (spec 2.4).
    if (usedUpWindow) {
      await this.log(threadId, [
        {
          kind: "usage-window-used-up",
          engineName: await this.engine.nameOf(engineId),
          window: usedUpWindow.window,
          resetsAt: usedUpWindow.resetsAt.toISOString(),
        },
      ]);
    }
    return {
      output: turn.output,
      problem,
      tokens: turn.usage,
      context: context && { tokens: context.tokens, window: context.window },
      ...(usedUpWindow && {
        usedUpWindow: { window: usedUpWindow.window, resetsAt: usedUpWindow.resetsAt },
      }),
    };
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

  /**
   * Moves the idle session of a held run's Stage Thread from the engine `from` to the Stand-in
   * Engine `standIn`, as the user chose (spec 5.4): carried over and recorded there, opening no
   * session on either engine, so the Stage's next run resumes it there. Refused while the Thread
   * is answering or its session isn't on `from`; a failed carry leaves the Thread on `from`.
   */
  async moveToStandIn(
    threadId: string,
    standIn: EngineModel,
    {
      from,
      ...why
    }: {
      readonly from: EngineId;
      readonly window: UsageWindowName;
      readonly resetsAt: Date;
    },
  ): Promise<void> {
    const thread = await this.repository.find(threadId);
    const failed = (cause: unknown) => new SwitchFailed(threadId, from, standIn.engineId, cause);
    if (!thread?.session) throw failed(new Error(`Thread ${threadId} has no session.`));
    if (thread.state === "answering" || this.bargeIns.has(threadId)) {
      throw failed(new Error("Its session is answering."));
    }
    if (thread.session.engineId !== from) {
      throw failed(new Error(`Its session runs on ${thread.session.engineId}, not ${from}.`));
    }
    try {
      await carrySessionToEngine(this.carrying, threadId, thread.session.id, {
        from,
        to: standIn.engineId,
        ...why,
      });
    } catch (error) {
      throw failed(error);
    }
  }

  /** What carries a session to a Stand-in Engine. */
  private get carrying(): SessionCarrying {
    return { engine: this.engine, change: (threadId, change) => this.change(threadId, change) };
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
 * Where a Stage's work goes on: its Thread, its person, the engine and model their session runs on
 * and their folder, since `began`.
 */
interface StageWorkPlace {
  readonly threadId: string;
  readonly roleKey: string;
  /** The person's name, as the service log names them. */
  readonly personName: string;
  readonly engine: EngineId;
  /** The cascade's engine `engine` stands in for; undefined when it is the cascade's. */
  readonly standInFor: SessionStandIn | undefined;
  /**
   * Read as the session opens: Stop must still reach a session whose engine was removed since,
   * as it finishes on the old engine (spec §5.4).
   */
  readonly canInterrupt: boolean;
  /** The session's context as the Stage's work begins: the Thread session's; 0 for a new one. */
  readonly contextTokens: number;
  /** The Stage's context limits; undefined for none. */
  readonly contextLimits: StageContextLimits | undefined;
  /** The session's model's window, as its last turn read it; undefined before its first. */
  readonly contextWindow: number | undefined;
  /** What resumes the session on a Stand-in Engine, as it was opened. */
  readonly reopening: Reopening;
  readonly model: string;
  readonly folder: string;
  /** Hides the Project's Secret variables in what the session writes into the Thread. */
  readonly mask: TextMask;
  readonly taskId: string;
  readonly began: Date;
  /** As a scheduled Office update lists the session's background Sub-agents. */
  readonly subAgentsLabel: string;
}

/**
 * What a Stage's session starts or continues with: the duties the person holds, which decide their
 * built-in tools, the engine, the Context policy's move and the Brief.
 */
interface StageSessionDecision {
  readonly held: HeldDuties;
  readonly applying: StageEngine;
  /** The cascade's engine `applying` stands in for; undefined when it is the cascade's. */
  readonly standInFor: SessionStandIn | undefined;
  readonly move: ContextDecision;
  readonly brief: Brief;
  /** The Brief's and the instructions' template texts, loaded as the session was decided. */
  readonly prompts: PromptTexts;
}

/**
 * The engine and model a Stage's session runs on, and the effort the model and effort cascade gives
 * (null leaves it to the runtime); `gaveWay` names the model a level set that the engine doesn't
 * offer, which gave way to its default.
 */
interface StageEngine extends EngineModel {
  readonly effort: Effort | null;
  readonly gaveWay?: string;
}

/**
 * What a Stage's session is resumed with: its Thread, the Stage's request, its person and duties,
 * and the effort it works with.
 */
interface Reopening {
  readonly threadId: string;
  readonly request: StageThreadRequest;
  readonly person: SessionRole & Pick<SessionPerson, "officeInstructions">;
  readonly held: HeldDuties;
  readonly effort: Effort | null;
}

/**
 * A new session opened in a Stage Thread: what it starts with, whether its engine can interrupt a
 * turn, its opening's watch, the id of its first message, and what resumes it.
 */
interface StartedSession {
  readonly opened: EngineSession;
  readonly canInterrupt: boolean;
  readonly start: SessionStartWatch;
  readonly firstMessageId: string;
  readonly reopening: Reopening;
}

/** A session resumed, whether its engine can interrupt a turn, and the MCP servers left out. */
interface Reopened {
  readonly opened: EngineSession;
  readonly canInterrupt: boolean;
  readonly leftOut: readonly LeftOutMcpServer[];
}

/** A Stage's request with its work carrying the user's undelivered messages, if any. */
interface Carrying {
  readonly request: StageThreadRequest;
  /** The images those messages carried, which go with the work. */
  readonly images: readonly MessageImageContent[];
  readonly carried: (carrierId: string) => CarriedMessages | undefined;
}

/** What a Stage's turn never reads: Sub-agents' and Processes' own events. */
const BACKGROUND_EVENT_KINDS: ReadonlySet<SessionEvent["kind"]> = new Set([
  "sub-agent-started",
  "sub-agent-changed",
  "sub-agent-progress",
  "sub-agent-ended",
  "process-started",
  "process-output",
  "process-ended",
]);

const STAGE_ENDING = "The Stage is ending. Send your message once it has ended.";

/**
 * What a Stage's engine calls carry (spec §5.2): ids on the span, which the `office.engine.call`
 * record reads, and only names on the metric. A Task in no Initiative carries `""`.
 */
export function stageThreadTelemetry(
  threadId: string,
  roleKey: string,
  request: Pick<
    StageThreadRequest,
    "taskId" | "initiativeId" | "stageName" | "stageRun" | "pipelineName" | "projectName"
  >,
): NonNullable<SessionSettings["telemetry"]> {
  return {
    span: {
      "office.task": request.taskId,
      "office.initiative": request.initiativeId ?? "",
      "office.thread": threadId,
      "office.role": roleKey,
      "office.stage": request.stageName,
      "office.stage.run": request.stageRun,
      "office.pipeline": request.pipelineName,
      "office.project": request.projectName,
    },
    metric: {
      "office.conversation.home": "task",
      "office.role": roleKey,
      "office.stage": request.stageName,
      "office.pipeline": request.pipelineName,
      "office.project": request.projectName,
    },
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
