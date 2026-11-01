import { Injectable, Logger } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { AsyncChannel } from "../../../platform/streams/async-channel.js";
import { Telemetry } from "../../../platform/telemetry/telemetry.js";
import { EngineDown } from "../domain/engine-events.js";
import { engineIdOf, type Engine, type EngineId } from "../domain/engines.js";
import type { UsageWindows } from "../domain/usage-windows.js";
import {
  CapabilityMissing,
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
import { DayUsage } from "./day-usage.js";
import { EngineCallSpans, SessionCosts, type SessionTelemetry } from "./engine-call-spans.js";
import { OfficeToolRegistry } from "./office-tool-registry.js";
import { UsageWindowState, type UsageWindowReading } from "./usage-window-state.js";

/** What a caller runs a session with: the Office tools by name, from the registry. */
export type SessionSettings = Omit<SessionOptions, "officeTools"> & {
  /** The engine the session runs on, which a resume names again: a session lives in one engine. */
  readonly engine: Engine;
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
 * asks, the Office's tokens so far on each engine, each day's use, and an "engine down" event when
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
  ) {}

  capabilitiesOf(engine: Engine): EngineCapabilities {
    return this.engines.of(engine).capabilities;
  }

  /** What `engine` declares it can't do, which the Role card names. */
  missingCapabilitiesOf(engine: Engine): readonly EngineCapability[] {
    return missingCapabilities(this.capabilitiesOf(engine));
  }

  async start({ id, settings, brief }: SessionStart): Promise<EngineSession> {
    const engine = this.engines.of(settings.engine);
    const options = this.optionsOf(settings);
    this.costs.started(id);
    const spans = this.spansOf(id, options, settings.telemetry);
    spans.messageSent(brief.id);
    return this.watch(id, settings, spans, () => engine.start({ id, options, brief }));
  }

  /**
   * Give a session the settings it started with, on the engine it started on: a changed set
   * breaks its cached prefix, and another engine has no such session.
   */
  async resume(sessionId: string, settings: SessionSettings): Promise<EngineSession> {
    const engine = this.engines.of(settings.engine);
    const options = this.optionsOf(settings);
    const spans = this.spansOf(sessionId, options, settings.telemetry);
    return this.watch(sessionId, settings, spans, () => engine.resume(sessionId, options));
  }

  private optionsOf({
    telemetry: _telemetry,
    engine: _engine,
    ...settings
  }: SessionSettings): SessionOptions {
    return { ...settings, officeTools: this.officeTools.named(settings.officeTools) };
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
    { engine, model }: SessionSettings,
    spans: EngineCallSpans,
    open: () => Promise<EngineSession>,
  ): Promise<EngineSession> {
    let session: EngineSession;
    try {
      session = await open();
    } catch (error) {
      spans.stopped(error);
      if (!isRefusal(error)) await this.engineDown(sessionId, error);
      throw error;
    }
    return new WatchedSession(session, spans, {
      rateLimited: async () => {
        await this.readUsageWindows(engine, session);
      },
      turnEnded: (usage) => this.turnEnded(engine, model, usage),
      failed: async (error) => {
        if (!isRefusal(error)) await this.engineDown(sessionId, error);
      },
    });
  }

  /**
   * Reads the account's windows through `session`, a session of this service on `engine`, with no
   * model call, and keeps the reading. Undefined on an engine without windows, for an account
   * without them, or when the read fails. A window not begun yet is read as unused.
   */
  async readUsageWindows(
    engine: Engine,
    session: EngineSession,
  ): Promise<UsageWindowReading | undefined> {
    if (!this.capabilitiesOf(engine).usageWindows) return undefined;
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
      officeTokensSoFar: this.officeTokensSoFar.get(engineIdOf(engine)) ?? NO_TOKENS,
    };
    await this.usageWindows.update(reading);
    return reading;
  }

  /** A failure to keep the day's use is logged: the session runs on, and its turn is reported. */
  private async turnEnded(engine: Engine, model: string, usage: TokenUsage): Promise<void> {
    const engineId = engineIdOf(engine);
    this.officeTokensSoFar.set(
      engineId,
      addedTokens(this.officeTokensSoFar.get(engineId) ?? NO_TOKENS, usage),
    );
    try {
      await this.dayUsage.add(engine, model, usage);
    } catch (error) {
      this.logger.error(`Keeping the day's use failed: ${messageOf(error)}`);
    }
  }

  private async engineDown(sessionId: string, error: unknown): Promise<void> {
    this.logger.error(`The engine is down for session ${sessionId}: ${messageOf(error)}`);
    await this.events.publish(new EngineDown(sessionId, messageOf(error)));
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
