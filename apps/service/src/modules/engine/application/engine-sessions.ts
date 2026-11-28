import { Injectable, Logger, Optional } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { OfficeTestInstance } from "../../../platform/test-instance/office-test-instance.js";
import { AsyncChannel } from "../../../platform/streams/async-channel.js";
import { Telemetry } from "../../../platform/telemetry/telemetry.js";
import { EngineDown, SkillCalled } from "../domain/engine-events.js";
import { EngineRefused } from "../domain/engine-refused.js";
import { calledSkill, skillNameOf } from "../domain/skill-calls.js";
import { BusyWork } from "../../busy-work/index.js";
import {
  COPILOT_CLI_AUTO_MODEL,
  hasUsageWindows,
  listsItsModels,
  type Engine,
  type EngineId,
  type EngineModel,
} from "../domain/engines.js";
import { withLeftOutLanguageServers } from "../domain/language-servers.js";
import { engineToRunOn } from "../domain/stand-in-engines.js";
import type { UsageWindows } from "../domain/usage-windows.js";
import {
  CapabilityMissing,
  EngineNotListed,
  missingCapabilities,
  ModelNotOffered,
  SessionSkillsDiffer,
  type EngineCapabilities,
  type EngineCapability,
  type OfficeToolLoading,
} from "../ports/agent-engine.js";
import { splitByArea, type HomeAreas } from "./office-tool-split.js";
import { officeToolPair } from "./office-tool-pair.js";
import type {
  ContextUsage,
  EngineSession,
  MessagePriority,
  UserMessage,
} from "../ports/engine-session.js";
import {
  type SessionEvent,
  type TokenUsage,
  type TurnEndedEvent,
} from "../ports/session-events.js";
import {
  SessionLanguageServers,
  type PreparedLanguageServers,
} from "../ports/session-language-servers.js";
import type { SessionOptions } from "../ports/session-options.js";
import { AgentEngines } from "./agent-engines.js";
import { EngineModels } from "./engine-models.js";
import { ModelPrices } from "./model-prices.js";
import { DayUsage } from "./day-usage.js";
import { EngineModelLists } from "./engine-model-lists.js";
import { EngineCallSpans, SessionCosts, type SessionTelemetry } from "./engine-call-spans.js";
import type { OfficeToolRuling } from "../ports/office-tool-ruling.js";
import { OfficeToolRegistry } from "./office-tool-registry.js";
import { RunningEngineSessions } from "./running-engine-sessions.js";
import { OfficeReachConfig } from "../../../platform/office-reach/office-reach-config.js";
import { UsageWindowReadings } from "./usage-window-readings.js";
import {
  UsageWindowState,
  type UsageWindowReading,
  type UsedUpUsageWindow,
} from "./usage-window-state.js";

/**
 * What a caller runs a session with: the engine by its id and the model by its id there, which a
 * resume names again, as a session lives in one engine; the Office tools by name, from the registry.
 */
export type SessionSettings = Omit<
  SessionOptions,
  "officeTools" | "deferredOfficeTools" | "engine" | "languageServers"
> &
  EngineModel & {
    readonly officeTools: readonly string[];
    /**
     * The areas, beside Core, whose tools the session loads from the start; the others are
     * reached on demand (spec 5.4.1 › Loading by area). `all` for a Stage, which loads every tool.
     */
    readonly homeAreas: HomeAreas;
    /** Rules every call of those tools, whichever engine makes it (spec 5.4.1 › One ruling step). */
    readonly officeToolRuling: OfficeToolRuling;
    /** What the caller tags the session's engine calls with, beside the engine's own attributes. */
    readonly telemetry?: SessionTelemetry;
    /**
     * Who works where, in the UI's words, as a scheduled Office update lists a turn it waits for:
     * "Jim in the Stage Implement".
     */
    readonly turnLabel: string;
  };

/** How a session loads the Office tools it isn't started with, as a refusal tells it. */
const LOADING_ADVICE: Record<OfficeToolLoading, string | undefined> = {
  all: undefined,
  deferred: "Load the tools of other areas with ToolSearch, select:mcp__office__<name>.",
  pair: "List the tools of other areas with list_office_tools, then call one with call_office_tool.",
};

const NO_LANGUAGE_SERVERS: PreparedLanguageServers = { servers: [], leftOut: [] };

export interface SessionStart {
  /** Chosen by the caller, as for the port: what is named after the session exists before it starts. */
  readonly id: string;
  readonly settings: SessionSettings;
  /** The first message, which starts the first turn. */
  readonly brief: UserMessage;
}

/**
 * Runs sessions on the engine each names for the other modules, and watches each: a span and a log
 * record per engine call with its tokens and its cost estimated from Model prices, the usage
 * windows read on each rate-limit signal and when a caller asks, paired Office-wide into what the
 * windows move by per token, the Office's tokens so far on each engine, each day's use, and an
 * "engine down" event when the engine can't start a session or stops running one (spec §5.4).
 */
@Injectable()
export class EngineSessions {
  private readonly logger = new Logger(EngineSessions.name);
  private readonly costs = new SessionCosts();

  constructor(
    private readonly engines: AgentEngines,
    private readonly telemetry: Telemetry,
    private readonly events: EventBus,
    private readonly usageWindows: UsageWindowState,
    private readonly officeTools: OfficeToolRegistry,
    private readonly dayUsage: DayUsage,
    private readonly readings: UsageWindowReadings,
    private readonly engineModels: EngineModels,
    private readonly running: RunningEngineSessions,
    private readonly busyWork: BusyWork,
    private readonly languageServers: SessionLanguageServers,
    private readonly prices: ModelPrices,
    @Optional() private readonly testInstance: OfficeTestInstance = OfficeTestInstance.OFF,
    @Optional() private readonly modelLists?: EngineModelLists,
    @Optional() private readonly officeReach?: OfficeReachConfig,
  ) {}

  /** What the engine listed as `engineId` can do; refused when Settings › Engines lists none. */
  async capabilitiesOf(engineId: EngineId): Promise<EngineCapabilities> {
    return this.engines.of(await this.listed(engineId)).capabilities;
  }

  /** How `engineId`'s sessions reach the Office tools they aren't started with; `all` once no engine is listed as it. */
  async officeToolLoadingOf(engineId: EngineId): Promise<OfficeToolLoading> {
    const engine = await this.find(engineId);
    return engine === undefined ? "all" : this.engines.of(engine).officeToolLoading;
  }

  /** Whether `engineId`'s sessions report how full their context is; false once none lists it. */
  async reportsContext(engineId: EngineId): Promise<boolean> {
    const engine = await this.find(engineId);
    return engine !== undefined && this.engines.of(engine).capabilities.contextUsage;
  }

  /** The name Settings › Engines gives `engineId`, or the id itself once none lists it. */
  async nameOf(engineId: EngineId): Promise<string> {
    return (await this.find(engineId))?.name ?? engineId;
  }

  /** Whether `engine`'s sessions read its account's usage windows: it has them and reads them. */
  readsUsageWindows(engine: Engine): boolean {
    return this.engines.readsUsageWindows(engine);
  }

  /** What `engine` declares it can't do, which the Role card names under its Engine field. */
  missingCapabilitiesOf(engine: Engine): readonly EngineCapability[] {
    return missingCapabilities(this.engines.of(engine).capabilities);
  }

  /** Refused with EngineRefused in a test instance of The Office (`OFFICE_TEST_INSTANCE`). */
  async start({ id, settings, brief }: SessionStart): Promise<EngineSession> {
    if (this.testInstance.on) throw new EngineRefused();
    return this.counted(settings.engineId, async (ended) => {
      const listed = await this.listed(settings.engineId);
      const engine = this.engines.of(listed);
      const { servers, leftOut } = engine.capabilities.languageServers
        ? await this.languageServers.prepare(id, settings.environment)
        : NO_LANGUAGE_SERVERS;
      const options = this.optionsOf(listed, settings, servers);
      this.costs.started(id);
      const spans = this.spansOf(id, options, settings);
      spans.messageSent(brief.id);
      return this.watch(id, listed, settings, spans, ended, () =>
        engine.start({
          id,
          options,
          brief: { ...brief, text: withLeftOutLanguageServers(brief.text, leftOut) },
        }),
      );
    });
  }

  /**
   * Give a session the settings it started with, on the engine it started on: a changed set
   * breaks its cached prefix, and another engine has no such session.
   */
  async resume(sessionId: string, settings: SessionSettings): Promise<EngineSession> {
    if (this.testInstance.on) throw new EngineRefused();
    return this.counted(settings.engineId, async (ended) => {
      const listed = await this.listed(settings.engineId);
      const engine = this.engines.of(listed);
      const servers = engine.capabilities.languageServers
        ? await this.languageServers.recorded(sessionId)
        : [];
      const options = this.optionsOf(listed, settings, servers);
      const spans = this.spansOf(sessionId, options, settings);
      return this.watch(sessionId, listed, settings, spans, ended, () =>
        engine.resume(sessionId, options),
      );
    });
  }

  /**
   * Carries the session `sessionId` over from the engine listed as `fromId` to the one listed as
   * `toId`, so a resume on `toId` goes on with its conversation (a Stand-in Engine taking over a
   * Stage, spec §5.4). Only called for an idle session, after its turn was refused and its engine
   * session ended: nothing may write its transcript meanwhile. Both engines must be listed
   * (`EngineNotListed`), Claude Code engines with the `carrySession` capability (`CapabilityMissing`);
   * throws `SessionNotCarried` when `fromId` holds no such session. The session counts as running on
   * `toId` while it is copied, so removing that engine waits for the copy. Idempotent: a carry cut
   * short is carried again.
   */
  async carrySession(sessionId: string, fromId: EngineId, toId: EngineId): Promise<void> {
    const ended = this.running.started(toId);
    try {
      const from = await this.listed(fromId);
      const to = await this.listed(toId);
      for (const engine of [from, to]) {
        if (!this.carriesSessions(engine)) throw new CapabilityMissing("carrySession");
      }
      await this.engines.of(from).carrySession(sessionId, from, to);
    } finally {
      ended();
    }
  }

  /**
   * Removes the ended session's files from the engine listed as `engineId`, as its Thread was
   * deleted (spec §2.4.1): the transcript of a Claude Code session, the thread of a Codex one;
   * nothing for an engine that keeps none, or one no longer listed. The session counts as running
   * on the engine meanwhile, so removing that engine waits for it.
   */
  async forgetSession(sessionId: string, engineId: EngineId): Promise<void> {
    const ended = this.running.started(engineId);
    try {
      const engine = await this.listed(engineId).catch((error: unknown) => {
        if (error instanceof EngineNotListed) return undefined;
        throw error;
      });
      if (engine) await this.engines.of(engine).forgetSession(sessionId, engine);
    } finally {
      ended();
    }
  }

  /**
   * The Stand-in Engine a session running on `running` goes on on once its turn was refused for a
   * used-up usage window (spec §5.4.6): the first of `standIns`, the list that applies where the
   * session runs (the caller's to give), that has every capability of `needs` and has room
   * (`engineToRunOn`), never `running` itself; null when none has. With `sameEngineType`, as a
   * running Stage, Switch now and a carried Thread ask, only stand-ins of `running`'s type that can
   * carry its session count, and none when a session on `running` can't be carried. An engine has
   * room when its usage window isn't used up and its latest reading shows it free or it hasn't been
   * read yet.
   */
  async standInFor(running: EngineId, options: StandInOptions): Promise<EngineId | null> {
    const { standIns, sameEngineType = false, needs = [] } = options;
    const { engines } = await this.engineModels.standIns();
    const engineOf = (engineId: EngineId) => engines.find(({ id }) => id === engineId);
    const runningEngine = engineOf(running);
    if (runningEngine === undefined) return null;
    if (sameEngineType && !this.carriesSessions(runningEngine)) return null;
    return engineToRunOn(
      running,
      standIns,
      engines,
      (engineId) => {
        if (engineId === running) return false;
        const engine = engineOf(engineId);
        return (
          engine !== undefined &&
          (!sameEngineType || this.carriesSessions(engine)) &&
          this.usageWindows.usedUpUntil(engineId) === undefined &&
          this.usageWindows.latestShowsFree(engineId)
        );
      },
      { sameEngineType, capable: this.capableOf(engines, needs) },
    );
  }

  /**
   * Whether an engine among `engines` has every capability of `needs`, for `engineToRunOn`; an
   * engine no longer listed has none.
   */
  capableOf(
    engines: readonly Engine[],
    needs: readonly EngineCapability[],
  ): (engineId: EngineId) => boolean {
    return (engineId) => {
      const engine = engines.find(({ id }) => id === engineId);
      if (engine === undefined) return false;
      const { capabilities } = this.engines.of(engine);
      return needs.every((capability) => capabilities[capability]);
    };
  }

  /** Whether a session on `engineId` can be carried to or from another: Claude Code's alone. */
  async carriesSessionsOf(engineId: EngineId): Promise<boolean> {
    const engine = await this.find(engineId);
    return engine !== undefined && this.carriesSessions(engine);
  }

  /**
   * `engineId`'s used-up usage window while its reset is ahead, as a refused turn made it known;
   * undefined while it has room. A person's Thread opens its next session on a Stand-in Engine
   * meanwhile (spec 5.4).
   */
  usedUpUntil(engineId: EngineId): UsedUpUsageWindow | undefined {
    return this.usageWindows.usedUpUntil(engineId);
  }

  /** Whether a session on `engine` can be carried to or from another: Claude Code's alone. */
  private carriesSessions(engine: Engine): boolean {
    return engine.kind === "claude-code" && this.engines.of(engine).capabilities.carrySession;
  }

  /**
   * Counts the session on `engineId` as running from before its engine is looked up until it
   * ends, or until opening it fails.
   */
  private async counted(
    engineId: EngineId,
    open: (ended: () => void) => Promise<EngineSession>,
  ): Promise<EngineSession> {
    const ended = this.running.started(engineId);
    try {
      return await open(ended);
    } catch (error) {
      ended();
      throw error;
    }
  }

  private async listed(engineId: EngineId): Promise<Engine> {
    const listed = await this.find(engineId);
    if (listed === undefined) throw new EngineNotListed(engineId);
    return listed;
  }

  private async find(engineId: EngineId): Promise<Engine | undefined> {
    return (await this.engineModels.engines()).find(({ id }) => id === engineId);
  }

  private optionsOf(
    engine: Engine,
    {
      telemetry: _telemetry,
      engineId: _engineId,
      turnLabel: _turnLabel,
      officeToolRuling,
      homeAreas,
      ...settings
    }: SessionSettings,
    languageServers: SessionOptions["languageServers"],
  ): SessionOptions {
    const allowed = this.officeTools.named(settings.officeTools, officeToolRuling);
    const loading = this.engines.of(engine).officeToolLoading;
    const { loaded, reachable } = splitByArea(allowed, loading === "all" ? "all" : homeAreas);
    return {
      ...settings,
      engine,
      officeTools:
        loading === "pair" && reachable.length > 0
          ? [...loaded, ...officeToolPair(reachable)]
          : loaded,
      deferredOfficeTools: loading === "deferred" ? reachable : [],
      ...(this.officeReach && {
        officeReach: {
          apiPort: this.officeReach.apiPort,
          databaseUrl: this.officeReach.databaseUrl,
        },
      }),
      ...(LOADING_ADVICE[loading] && { officeToolsAdvice: LOADING_ADVICE[loading] }),
      languageServers,
    };
  }

  private spansOf(
    sessionId: string,
    options: SessionOptions,
    { telemetry, turnLabel }: SessionSettings,
  ): EngineCallSpans {
    const countBusy = () => this.busyWork.begin({ kind: "turn", label: turnLabel });
    return new EngineCallSpans(
      this.telemetry,
      this.costs,
      this.prices,
      sessionId,
      options,
      telemetry,
      countBusy,
    );
  }

  private async watch(
    sessionId: string,
    engine: Engine,
    settings: SessionSettings,
    spans: EngineCallSpans,
    ended: () => void,
    open: () => Promise<EngineSession>,
  ): Promise<EngineSession> {
    let session: EngineSession;
    try {
      session = await open();
    } catch (error) {
      spans.stopped(error);
      if (refusedModel(error, settings.model)) this.modelRefused(engine);
      if (!isRefusal(error)) await this.engineDown(sessionId, engine, error);
      throw error;
    }
    return new WatchedSession(session, spans, {
      rateLimited: async () => {
        await this.readUsageWindows(settings, session).catch((error: unknown) => {
          this.logger.warn(`Reading the usage windows failed: ${messageOf(error)}`);
        });
      },
      turnEnded: (usage) => this.turnEnded(settings, usage),
      refused: async (refusedTurn) => {
        if (!hasUsageWindows(engine)) return asFailedTurn(refusedTurn);
        if (refusedTurn.usedUpWindow === undefined) return refusedTurn;
        const usedUpWindow = await this.usageWindows.refused(engine, refusedTurn.usedUpWindow);
        return { ...refusedTurn, usedUpWindow };
      },
      skillCalled: (skill) => this.skillCalled(sessionId, engine.id, skill),
      turnFailed: ({ errors }) => {
        if (namesModel(errors, settings.model)) this.modelRefused(engine);
      },
      failed: async (error) => {
        if (refusedModel(error, settings.model)) this.modelRefused(engine);
        if (!isRefusal(error)) await this.engineDown(sessionId, engine, error);
      },
      ended,
    });
  }

  /**
   * Reads the account's windows through `session`, a session of this service on these settings, with no
   * model call, and keeps the reading. Undefined on an engine without windows, for an account
   * without them, or when the read fails. A window not begun yet is read as unused.
   */
  async readUsageWindows(
    { engineId }: Pick<SessionSettings, "engineId">,
    session: EngineSession,
  ): Promise<UsageWindowReading | undefined> {
    const engine = await this.find(engineId);
    if (engine === undefined || !this.readsUsageWindows(engine)) return undefined;
    let windows: UsageWindows | undefined;
    try {
      windows = await session.readUsageWindows();
    } catch (error) {
      this.logger.warn(`Reading the usage windows failed: ${messageOf(error)}`);
      return undefined;
    }
    if (windows === undefined) return undefined;
    return this.readings.keep(engine, windows);
  }

  /** A failure to keep the day's use is logged: the session runs on, and its turn is reported. */
  private async turnEnded({ engineId, model }: EngineModel, usage: TokenUsage): Promise<void> {
    this.readings.turnEnded(engineId, usage);
    try {
      await this.dayUsage.add({ engineId, model }, usage);
    } catch (error) {
      this.logger.error(`Keeping the day's use failed: ${messageOf(error)}`);
    }
  }

  /** The bus logs a handler that fails to count the use: the session runs on. */
  private async skillCalled(sessionId: string, engineId: EngineId, skill: string): Promise<void> {
    await this.events.publish(new SkillCalled(sessionId, engineId, skill, new Date()));
  }

  /**
   * A session on `engine` was refused for its model, which the engine's kept list may still offer
   * though its account no longer does: the list is asked for again, in the background, once for a
   * burst of refusals (`EngineModelLists.modelRefused`).
   */
  private modelRefused(engine: Engine): void {
    if (listsItsModels(engine.kind)) this.modelLists?.modelRefused(engine.id);
  }

  private async engineDown(sessionId: string, engine: Engine, error: unknown): Promise<void> {
    const reason = messageOf(error);
    this.logger.error(`The engine ${engine.id} is down for session ${sessionId}: ${reason}`);
    await this.events.publish(new EngineDown(sessionId, engine.id, engine.name, reason));
  }
}

/** What a refused turn reads as on an engine without usage windows, such as an API key's limit. */
const NO_USAGE_WINDOW_REFUSAL = "The engine refused the turn: its rate limit was reached.";

/**
 * A turn refused on an engine without usage windows, which has no window to use up: an API's rate
 * limit, which fails the turn as any other failure does and pauses no Task.
 */
function asFailedTurn({ usedUpWindow: _usedUpWindow, ...turn }: TurnEndedEvent): TurnEndedEvent {
  return {
    ...turn,
    outcome: "failed",
    errors: turn.errors.length > 0 ? turn.errors : [NO_USAGE_WINDOW_REFUSAL],
  };
}

interface SessionWatch {
  /** Never rejects: a failed read is logged. */
  readonly rateLimited: () => Promise<void>;
  readonly turnEnded: (usage: TokenUsage) => Promise<void>;
  /**
   * A turn was refused for a used-up usage window: it answers the turn with its reset settled, or
   * as failed on an engine without windows.
   */
  readonly refused: (ended: TurnEndedEvent) => Promise<TurnEndedEvent>;
  /** A turn failed, in the engine's words; the session runs on. */
  readonly turnFailed: (ended: TurnEndedEvent) => void;
  /**
   * The session's Agent or a subagent called the Skill tool for `skill`, or the user sent a skill
   * command running it. Never rejects, as the bus logs a handler that fails.
   */
  readonly skillCalled: (skill: string) => Promise<void>;
  readonly failed: (error: unknown) => Promise<void>;
  /** The session's events have closed or failed: it runs no more. */
  readonly ended: () => void;
}

/** A session as the engine runs it, its events read as they come so each is watched when it happens. */
class WatchedSession implements EngineSession {
  private readonly reported = new AsyncChannel<SessionEvent>();
  private readonly read: Promise<void>;
  /** Rate-limit signals come several to a turn; one read of the windows at a time answers them. */
  private readingWindows = false;

  constructor(
    private readonly session: EngineSession,
    private readonly spans: EngineCallSpans,
    private readonly watch: SessionWatch,
  ) {
    this.read = this.readEvents();
  }

  get id(): string {
    return this.session.id;
  }

  get events(): AsyncIterable<SessionEvent> {
    return this.reported;
  }

  /**
   * A skill command is a use of its skill as a Skill call is (spec §2.6), announced by the name the
   * session lists it as, as the call would name it; the engine reports no Skill call for it.
   */
  send(message: UserMessage, priority: MessagePriority): void {
    this.spans.messageSent(message.id);
    const commanded = message.skillCommand && skillNameOf(message.skillCommand.skill);
    // oxlint-disable-next-line office/caught-voided-calls -- the watch logs its own failure
    if (commanded) void this.watch.skillCalled(commanded);
    this.session.send(message, priority);
  }

  interrupt(): Promise<void> {
    return this.session.interrupt();
  }

  readUsageWindows(): Promise<UsageWindows | undefined> {
    return this.session.readUsageWindows();
  }

  readContextUsage(): Promise<ContextUsage> {
    return this.session.readContextUsage();
  }

  async end(): Promise<void> {
    await this.session.end();
    await this.read;
  }

  private async readEvents(): Promise<void> {
    try {
      for await (const event of this.session.events) {
        this.reported.push(await this.observe(event));
      }
      this.spans.stopped();
      this.reported.close();
    } catch (error) {
      this.spans.stopped(error);
      await this.watch.failed(error);
      this.reported.fail(error);
    } finally {
      this.watch.ended();
    }
  }

  /** The event as it is reported: a refused turn with its reset settled. */
  private async observe(event: SessionEvent): Promise<SessionEvent> {
    if (event.kind === "turn-ended") {
      this.spans.turnEnded(event);
      // Counted before the turn is reported, so a reading or the day's use read once it ended includes it.
      await this.watch.turnEnded(event.usage);
      if (event.outcome === "usage-window-used-up") return this.watch.refused(event);
      if (event.outcome === "failed") this.watch.turnFailed(event);
    }
    if (event.kind === "tool-call") {
      const skill = calledSkill(event.tool, event.input);
      if (skill !== undefined) await this.watch.skillCalled(skill);
    }
    if (event.kind === "rate-limit" && !this.readingWindows) {
      this.readingWindows = true;
      // oxlint-disable-next-line office/caught-voided-calls -- the watch logs its own failure
      void this.watch.rateLimited().finally(() => (this.readingWindows = false));
    }
    return event;
  }
}

/**
 * Refusing what the engine can't do, a session without exactly its skills, or a model the engine
 * doesn't offer now, is the caller's to handle; the engine is not down.
 */
function isRefusal(error: unknown): boolean {
  return (
    error instanceof CapabilityMissing ||
    error instanceof SessionSkillsDiffer ||
    error instanceof ModelNotOffered
  );
}

/**
 * Whether a failed turn's errors name `model` by its id, as the Claude Code and Codex runtimes word
 * a model the account no longer offers ("There's an issue with the selected model (…)", "The '…'
 * model is not supported …"): no runtime tells it apart by a code, so naming it is the sign. Auto,
 * a word any error may hold, names no model.
 */
function namesModel(errors: readonly string[], model: string): boolean {
  if (model === "" || model === COPILOT_CLI_AUTO_MODEL) return false;
  const named = new RegExp(`(^|[^\\w.-])${escapedForRegExp(model)}($|[^\\w.-])`);
  return errors.some((error) => named.test(error));
}

/** Whether a session failed to open or to run as its model isn't offered. */
function refusedModel(error: unknown, model: string): boolean {
  return error instanceof ModelNotOffered || namesModel([messageOf(error)], model);
}

function escapedForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What `EngineSessions.standInFor` weighs besides the running engine. */
export interface StandInOptions {
  /** The Stand-in Engine list that applies where the session runs: the Project's own or the Office's. */
  readonly standIns: readonly EngineId[];
  /** Only stand-ins of the running engine's type that can carry its session count. */
  readonly sameEngineType?: boolean;
  /** The capabilities the session needs of a stand-in. */
  readonly needs?: readonly EngineCapability[];
}
