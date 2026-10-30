import { Injectable, Logger } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { AsyncChannel } from "../../../platform/streams/async-channel.js";
import { Telemetry } from "../../../platform/telemetry/telemetry.js";
import { EngineDown } from "../domain/engine-events.js";
import type { Engine } from "../domain/engines.js";
import type { UsageWindows } from "../domain/usage-windows.js";
import {
  CapabilityMissing,
  SessionSkillsDiffer,
  type EngineCapabilities,
} from "../ports/agent-engine.js";
import type {
  ContextUsage,
  EngineSession,
  MessagePriority,
  UserMessage,
} from "../ports/engine-session.js";
import type { SessionEvent } from "../ports/session-events.js";
import type { SessionOptions } from "../ports/session-options.js";
import { AgentEngines } from "./agent-engines.js";
import { EngineCallSpans, SessionCosts, type SessionTelemetry } from "./engine-call-spans.js";
import { OfficeToolRegistry } from "./office-tool-registry.js";
import { UsageWindowState } from "./usage-window-state.js";

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
 * with its tokens and cost, the usage windows read on each rate-limit signal, and an "engine
 * down" event when the engine can't start a session or stops running one (spec §5.4).
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
  ) {}

  capabilitiesOf(engine: Engine): EngineCapabilities {
    return this.engines.of(engine).capabilities;
  }

  async start({ id, settings, brief }: SessionStart): Promise<EngineSession> {
    const engine = this.engines.of(settings.engine);
    const options = this.optionsOf(settings);
    this.costs.started(id);
    const spans = this.spansOf(id, options, settings.telemetry);
    spans.messageSent(brief.id);
    return this.watch(id, settings.engine, spans, () => engine.start({ id, options, brief }));
  }

  /**
   * Give a session the settings it started with, on the engine it started on: a changed set
   * breaks its cached prefix, and another engine has no such session.
   */
  async resume(sessionId: string, settings: SessionSettings): Promise<EngineSession> {
    const engine = this.engines.of(settings.engine);
    const options = this.optionsOf(settings);
    const spans = this.spansOf(sessionId, options, settings.telemetry);
    return this.watch(sessionId, settings.engine, spans, () => engine.resume(sessionId, options));
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
    engine: Engine,
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
      rateLimited: () => this.readUsageWindows(engine, session),
      failed: async (error) => {
        if (!isRefusal(error)) await this.engineDown(sessionId, error);
      },
    });
  }

  private async readUsageWindows(engine: Engine, session: EngineSession): Promise<void> {
    if (!this.capabilitiesOf(engine).usageWindows) return;
    let windows: UsageWindows | undefined;
    try {
      windows = await session.readUsageWindows();
    } catch (error) {
      this.logger.warn(`Reading the usage windows failed: ${messageOf(error)}`);
      return;
    }
    if (windows !== undefined) await this.usageWindows.update(windows);
  }

  private async engineDown(sessionId: string, error: unknown): Promise<void> {
    this.logger.error(`The engine is down for session ${sessionId}: ${messageOf(error)}`);
    await this.events.publish(new EngineDown(sessionId, messageOf(error)));
  }
}

interface SessionWatch {
  readonly rateLimited: () => Promise<void>;
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
        this.observe(event);
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

  private observe(event: SessionEvent): void {
    if (event.kind === "turn-ended") this.spans.turnEnded(event);
    if (event.kind === "rate-limit" && !this.readingWindows) {
      this.readingWindows = true;
      void this.watch.rateLimited().finally(() => (this.readingWindows = false));
    }
  }
}

/**
 * Refusing what the engine can't do, or a session without exactly its skills, is the caller's to
 * handle; the engine is not down.
 */
function isRefusal(error: unknown): boolean {
  return error instanceof CapabilityMissing || error instanceof SessionSkillsDiffer;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
