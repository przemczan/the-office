import { Injectable, Logger } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { AsyncChannel } from "../../../platform/streams/async-channel.js";
import { Telemetry } from "../../../platform/telemetry/telemetry.js";
import { EngineDown } from "../domain/engine-events.js";
import type { UsageWindows } from "../domain/usage-windows.js";
import { AgentEngine, type EngineCapabilities, type NewSession } from "../ports/agent-engine.js";
import type { EngineSession, MessagePriority, UserMessage } from "../ports/engine-session.js";
import type { SessionEvent } from "../ports/session-events.js";
import type { SessionOptions } from "../ports/session-options.js";
import { EngineCallSpans, SessionCosts } from "./engine-call-spans.js";
import { UsageWindowState } from "./usage-window-state.js";

/**
 * Runs sessions on the engine for the other modules, and watches each: a span per engine call
 * with its tokens and cost, the usage windows read on each rate-limit signal, and an "engine
 * down" event when the engine can't start a session or stops running one (spec §5.4).
 */
@Injectable()
export class EngineSessions {
  private readonly logger = new Logger(EngineSessions.name);
  private readonly costs = new SessionCosts();

  constructor(
    private readonly engine: AgentEngine,
    private readonly telemetry: Telemetry,
    private readonly events: EventBus,
    private readonly usageWindows: UsageWindowState,
  ) {}

  get capabilities(): EngineCapabilities {
    return this.engine.capabilities;
  }

  async start(session: NewSession): Promise<EngineSession> {
    this.costs.started(session.id);
    const spans = this.spansOf(session.id, session.options);
    spans.messageSent(session.brief.id);
    return this.watch(session.id, spans, () => this.engine.start(session));
  }

  async resume(sessionId: string, options: SessionOptions): Promise<EngineSession> {
    return this.watch(sessionId, this.spansOf(sessionId, options), () =>
      this.engine.resume(sessionId, options),
    );
  }

  private spansOf(sessionId: string, options: SessionOptions): EngineCallSpans {
    return new EngineCallSpans(this.telemetry, this.costs, sessionId, options);
  }

  private async watch(
    sessionId: string,
    spans: EngineCallSpans,
    open: () => Promise<EngineSession>,
  ): Promise<EngineSession> {
    let session: EngineSession;
    try {
      session = await open();
    } catch (error) {
      spans.stopped(error);
      await this.engineDown(sessionId, error);
      throw error;
    }
    return new WatchedSession(session, spans, {
      rateLimited: () => this.readUsageWindows(session),
      failed: (error) => this.engineDown(sessionId, error),
    });
  }

  private async readUsageWindows(session: EngineSession): Promise<void> {
    if (!this.engine.capabilities.usageWindows) return;
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
