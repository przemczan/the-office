import { Injectable, Logger } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { AsyncChannel } from "../../../platform/streams/async-channel.js";
import { Telemetry } from "../../../platform/telemetry/telemetry.js";
import { EngineDown } from "../domain/engine-events.js";
import type { Engine, EngineId, EngineModel } from "../domain/engines.js";
import type { UsageWindows } from "../domain/usage-windows.js";
import {
  CapabilityMissing,
  EngineNotListed,
  missingCapabilities,
  ModelNotOffered,
  SessionSkillsDiffer,
  type EngineCapabilities,
  type EngineCapability,
} from "../ports/agent-engine.js";
import type {
  ContextUsage,
  EngineSession,
  MessagePriority,
  UserMessage,
} from "../ports/engine-session.js";
import {
  addedTokens,
  NO_TOKENS,
  type SessionEvent,
  type TokenUsage,
} from "../ports/session-events.js";
import type { SessionOptions } from "../ports/session-options.js";
import { AgentEngines } from "./agent-engines.js";
import { EngineModels } from "./engine-models.js";
import { DayUsage } from "./day-usage.js";
import { EngineCallSpans, SessionCosts, type SessionTelemetry } from "./engine-call-spans.js";
import { OfficeToolRegistry } from "./office-tool-registry.js";
import { UsageWindowSamples } from "./usage-window-samples.js";
import { UsageWindowState, type UsageWindowReading } from "./usage-window-state.js";

/**
 * What a caller runs a session with: the engine by its id and the model by its id there, which a
 * resume names again, as a session lives in one engine; the Office tools by name, from the registry.
 */
export type SessionSettings = Omit<SessionOptions, "officeTools" | "engine"> &
  EngineModel & {
    readonly officeTools: readonly string[];
    /** What the caller tags the session's engine calls with, beside the engine's own attributes. */
    readonly telemetry?: SessionTelemetry;
  };

export interface SessionStart {
  /** Chosen by the caller, as for the port: what is named after the session exists before it starts. */
  readonly id: string;
  readonly settings: SessionSettings;
  /** The first message, which starts the first turn. */
  readonly brief: UserMessage;
}

/**
 * Runs sessions on the engine each names for the other modules, and watches each: a span per engine call
 * with its tokens and cost, the usage windows read on each rate-limit signal and when a caller
 * asks, paired Office-wide into what the windows move by per token, the Office's tokens so far on
 * each engine, each day's use, and an "engine down" event when
 * the engine can't start a session or stops running one (spec §5.4).
 */
@Injectable()
export class EngineSessions {
  private readonly logger = new Logger(EngineSessions.name);
  private readonly costs = new SessionCosts();
  /** Every turn's tokens on each engine since the service started, which its readings carry. */
  private readonly officeTokensSoFar = new Map<EngineId, TokenUsage>();

  constructor(
    private readonly engines: AgentEngines,
    private readonly telemetry: Telemetry,
    private readonly events: EventBus,
    private readonly usageWindows: UsageWindowState,
    private readonly officeTools: OfficeToolRegistry,
    private readonly dayUsage: DayUsage,
    private readonly windowSamples: UsageWindowSamples,
    private readonly engineModels: EngineModels,
  ) {}

  /** What the engine listed as `engineId` can do; refused when Settings › Engines lists none. */
  async capabilitiesOf(engineId: EngineId): Promise<EngineCapabilities> {
    return this.engines.of(await this.listed(engineId)).capabilities;
  }

  /** Whether `engine`'s sessions read its account's usage windows. */
  readsUsageWindows(engine: Engine): boolean {
    return this.engines.of(engine).capabilities.usageWindows;
  }

  /** What `engine` declares it can't do, which the Role card names under its Engine field. */
  missingCapabilitiesOf(engine: Engine): readonly EngineCapability[] {
    return missingCapabilities(this.engines.of(engine).capabilities);
  }

  async start({ id, settings, brief }: SessionStart): Promise<EngineSession> {
    const listed = await this.listed(settings.engineId);
    const engine = this.engines.of(listed);
    const options = this.optionsOf(listed, settings);
    this.costs.started(id);
    const spans = this.spansOf(id, options, settings.telemetry);
    spans.messageSent(brief.id);
    return this.watch(id, listed, settings, spans, () => engine.start({ id, options, brief }));
  }

  /**
   * Give a session the settings it started with, on the engine it started on: a changed set
   * breaks its cached prefix, and another engine has no such session.
   */
  async resume(sessionId: string, settings: SessionSettings): Promise<EngineSession> {
    const listed = await this.listed(settings.engineId);
    const engine = this.engines.of(listed);
    const options = this.optionsOf(listed, settings);
    const spans = this.spansOf(sessionId, options, settings.telemetry);
    return this.watch(sessionId, listed, settings, spans, () => engine.resume(sessionId, options));
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
    { telemetry: _telemetry, engineId: _engineId, ...settings }: SessionSettings,
  ): SessionOptions {
    return { ...settings, engine, officeTools: this.officeTools.named(settings.officeTools) };
  }

  private spansOf(
    sessionId: string,
    options: SessionOptions,
    telemetry: SessionTelemetry | undefined,
  ): EngineCallSpans {
    return new EngineCallSpans(this.telemetry, this.costs, sessionId, options, telemetry);
  }

  private async watch(
    sessionId: string,
    engine: Engine,
    settings: SessionSettings,
    spans: EngineCallSpans,
    open: () => Promise<EngineSession>,
  ): Promise<EngineSession> {
    let session: EngineSession;
    try {
      session = await open();
    } catch (error) {
      spans.stopped(error);
      if (!isRefusal(error)) await this.engineDown(sessionId, engine, error);
      throw error;
    }
    return new WatchedSession(session, spans, {
      rateLimited: async () => {
        await this.readUsageWindows(settings, session);
      },
      turnEnded: (usage) => this.turnEnded(settings, usage),
      failed: async (error) => {
        if (!isRefusal(error)) await this.engineDown(sessionId, engine, error);
      },
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
    const reading: UsageWindowReading = {
      ...windows,
      readAt: new Date(),
      officeTokensSoFar: this.officeTokensSoFar.get(engineId) ?? NO_TOKENS,
    };
    await this.usageWindows.update(engine, reading);
    await this.keepSample(engineId, reading);
    return reading;
  }

  /** A failure to keep a pair of readings is logged: the reading stands. */
  private async keepSample(engineId: EngineId, reading: UsageWindowReading): Promise<void> {
    try {
      await this.windowSamples.add(engineId, reading);
    } catch (error) {
      this.logger.error(`Keeping a pair of usage readings failed: ${messageOf(error)}`);
    }
  }

  /** A failure to keep the day's use is logged: the session runs on, and its turn is reported. */
  private async turnEnded({ engineId, model }: EngineModel, usage: TokenUsage): Promise<void> {
    this.officeTokensSoFar.set(
      engineId,
      addedTokens(this.officeTokensSoFar.get(engineId) ?? NO_TOKENS, usage),
    );
    try {
      await this.dayUsage.add({ engineId, model }, usage);
    } catch (error) {
      this.logger.error(`Keeping the day's use failed: ${messageOf(error)}`);
    }
  }

  private async engineDown(sessionId: string, engine: Engine, error: unknown): Promise<void> {
    const reason = messageOf(error);
    this.logger.error(`The engine ${engine.id} is down for session ${sessionId}: ${reason}`);
    await this.events.publish(new EngineDown(sessionId, engine.id, engine.name, reason));
  }
}

interface SessionWatch {
  readonly rateLimited: () => Promise<void>;
  readonly turnEnded: (usage: TokenUsage) => Promise<void>;
  readonly failed: (error: unknown) => Promise<void>;
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

  send(message: UserMessage, priority: MessagePriority): void {
    this.spans.messageSent(message.id);
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
        await this.observe(event);
        this.reported.push(event);
      }
      this.spans.stopped();
      this.reported.close();
    } catch (error) {
      this.spans.stopped(error);
      await this.watch.failed(error);
      this.reported.fail(error);
    }
  }

  private async observe(event: SessionEvent): Promise<void> {
    if (event.kind === "turn-ended") {
      this.spans.turnEnded(event);
      // Counted before the turn is reported, so a reading or the day's use read once it ended includes it.
      await this.watch.turnEnded(event.usage);
    }
    if (event.kind === "rate-limit" && !this.readingWindows) {
      this.readingWindows = true;
      void this.watch.rateLimited().finally(() => (this.readingWindows = false));
    }
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
