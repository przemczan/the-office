import {
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule, type Wait } from "../../../platform/schedule/schedule.js";
import { OfficeTestInstance } from "../../../platform/test-instance/office-test-instance.js";
import {
  EngineAccountChanged,
  EngineAdded,
  EngineRemoved,
  UsageWindowReset,
  UsageWindowsChanged,
  WindowStartRecorded,
  WindowStartSettingsChanged,
} from "../domain/engine-events.js";
import type { Engine, EngineId } from "../domain/engines.js";
import type { UsageWindows } from "../domain/usage-windows.js";
import {
  nextWindowStart,
  NO_WINDOW_START,
  WINDOW_START_AFTER_RESET_DELAY,
  windowStartSkipReason,
  type WindowStartRecord,
  type WindowStartTrigger,
} from "../domain/window-starts.js";
import type { TokenUsage } from "../ports/session-events.js";
import { WindowStartRepository } from "../ports/window-start-repository.js";
import { AgentEngines } from "./agent-engines.js";
import { DayUsage } from "./day-usage.js";
import { EngineModels } from "./engine-models.js";
import { NextWindowStarts } from "./next-window-starts.js";
import { UsageWindowReadings } from "./usage-window-readings.js";
import { UsageWindowState } from "./usage-window-state.js";

export const WINDOW_START = "A Window start";

/**
 * Starts each engine's 5-hour window by itself (spec §5.4.6, "Starting the 5-hour window"): one
 * wait per engine for its next start, set at boot without catching up the set times missed while
 * the service was down, and set again whenever its settings, its readings, its account or the
 * engines change.
 * As a start fires it reads the windows afresh, judges the skip rules on that reading, starts the
 * window when none applies and reads again, then records the start, skip or failure and announces
 * it. One start at a time; a failed one waits for the next trigger. A test instance of The Office
 * (`OFFICE_TEST_INSTANCE`) schedules none.
 */
@Injectable()
export class WindowStarts implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WindowStarts.name);
  /** Ends a read or start under way as the service stops. */
  private readonly stopping = new AbortController();
  private readonly waits = new Map<EngineId, Wait>();
  /** The 5-hour reset each engine's after-reset start already fired for, so each fires once. */
  private readonly handledResets = new Map<EngineId, number>();
  /** The starts in the order they fired, so one runs at a time. */
  private starting: Promise<void> = Promise.resolve();

  constructor(
    private readonly engines: AgentEngines,
    private readonly engineModels: EngineModels,
    private readonly readings: UsageWindowReadings,
    private readonly state: UsageWindowState,
    private readonly dayUsage: DayUsage,
    private readonly repository: WindowStartRepository,
    private readonly nextStarts: NextWindowStarts,
    private readonly events: EventBus,
    private readonly schedule: Schedule,
    @Optional() private readonly testInstance: OfficeTestInstance = OfficeTestInstance.OFF,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.testInstance.on) return;
    this.events.subscribe(WindowStartSettingsChanged, ({ engineId }) =>
      this.plan(engineId, { announce: true }),
    );
    this.events.subscribe(UsageWindowsChanged, ({ engineId }) => this.plan(engineId));
    this.events.subscribe(UsageWindowReset, ({ engineId }) => this.plan(engineId));
    this.events.subscribe(EngineAdded, ({ engineId }) => this.plan(engineId));
    this.events.subscribe(EngineRemoved, ({ engineId }) => this.removed(engineId));
    // A sign-in by an API key or an account decides whether the engine has usage windows.
    this.events.subscribe(EngineAccountChanged, ({ engineId }) => this.plan(engineId));
    try {
      for (const engine of await this.engineModels.engines()) await this.plan(engine.id);
    } catch (error) {
      this.logger.error(`Working out the next Window starts failed: ${messageOf(error)}`);
    }
  }

  onModuleDestroy(): void {
    this.stopping.abort(new Error("The service is stopping."));
    for (const wait of this.waits.values()) wait.cancel();
    this.waits.clear();
  }

  /**
   * Sets `engineId`'s wait for its next start again, or none, and announces it when the next start
   * moved, or always with `announce`.
   */
  private async plan(engineId: EngineId, { announce = false } = {}): Promise<void> {
    if (this.stopping.signal.aborted) return;
    const engine = await this.listed(engineId);
    const settings =
      engine === undefined ? undefined : ((await this.repository.of(engineId)) ?? NO_WINDOW_START);
    const next =
      settings === undefined
        ? undefined
        : nextWindowStart(settings, this.unhandledReset(engineId), this.schedule.now());
    this.waits.get(engineId)?.cancel();
    this.waits.delete(engineId);
    if (next !== undefined) {
      const wait = this.schedule.once(`${WINDOW_START} of ${engineId}`, next.at, () =>
        this.fired(engineId, next.trigger),
      );
      this.waits.set(engineId, wait);
    }
    const moved = this.nextStarts.set(engineId, next);
    if (moved || announce) await this.events.publish(new WindowStartRecorded(engineId));
  }

  private async removed(engineId: EngineId): Promise<void> {
    this.handledResets.delete(engineId);
    await this.plan(engineId);
  }

  /** The engine as listed now, when it starts its 5-hour window by itself. */
  private async listed(engineId: EngineId): Promise<Engine | undefined> {
    const engine = (await this.engineModels.engines()).find(({ id }) => id === engineId);
    if (engine === undefined || !this.engines.readsUsageWindows(engine)) return undefined;
    return this.engines.of(engine).capabilities.startsUsageWindow ? engine : undefined;
  }

  /**
   * The latest reading's 5-hour reset, unless an after-reset start already fired for it. Readings
   * of two sources round a reset differently, so one within the delay of the handled one is it.
   */
  private unhandledReset(engineId: EngineId): Date | undefined {
    const resetsAt = this.state.of(engineId)?.fiveHour.resetsAt;
    const handled = this.handledResets.get(engineId);
    if (resetsAt === undefined) return undefined;
    if (handled !== undefined && resetsAt.getTime() <= handled + WINDOW_START_AFTER_RESET_DELAY) {
      return undefined;
    }
    return resetsAt;
  }

  private fired(engineId: EngineId, trigger: WindowStartTrigger): Promise<void> {
    this.waits.delete(engineId);
    if (trigger === "after-reset") {
      const resetsAt = this.state.of(engineId)?.fiveHour.resetsAt;
      if (resetsAt !== undefined) this.handledResets.set(engineId, resetsAt.getTime());
    }
    const started = this.starting.then(() => this.start(engineId, trigger));
    this.starting = started.catch(() => undefined);
    return started;
  }

  private async start(engineId: EngineId, trigger: WindowStartTrigger): Promise<void> {
    if (this.stopping.signal.aborted) return;
    const engine = await this.listed(engineId);
    if (engine !== undefined) {
      await this.repository.record(engineId, await this.attempt(engine, trigger));
    }
    await this.plan(engineId, { announce: true });
  }

  /** Judges a start on a fresh reading, starting the window when no skip rule applies. */
  private async attempt(engine: Engine, trigger: WindowStartTrigger): Promise<WindowStartRecord> {
    const at = this.schedule.now();
    const reason = windowStartSkipReason({
      reading: await this.freshReading(engine),
      usedUp: this.state.usedUpUntil(engine.id) !== undefined,
      now: this.schedule.now(),
    });
    if (reason !== undefined) return { at, outcome: "skipped", trigger, reason };
    try {
      const { tokens, model } = await this.engines
        .of(engine)
        .startUsageWindow(engine, this.stopping.signal);
      // A start is engine use like any turn, so the readings' pairs and the day's use stay honest.
      this.readings.turnEnded(engine.id, tokens);
      await this.keepDayUsage(engine.id, model, tokens);
    } catch (error) {
      this.logger.warn(`Starting the 5-hour window of ${engine.id} failed: ${messageOf(error)}`);
      return { at, outcome: "failed", trigger, error: messageOf(error) };
    }
    const after = await this.freshReading(engine);
    return { at, outcome: "started", trigger, fiveHourResetsAt: after?.fiveHour.resetsAt };
  }

  /** The windows read now and kept as any reading; undefined when the read fails or tells none. */
  private async freshReading(engine: Engine): Promise<UsageWindows | undefined> {
    try {
      const windows = await this.engines.of(engine).readUsageWindows(engine, this.stopping.signal);
      return windows === undefined ? undefined : await this.readings.keep(engine, windows);
    } catch (error) {
      this.logger.warn(`Reading the usage windows of ${engine.id} failed: ${messageOf(error)}`);
      return undefined;
    }
  }

  private async keepDayUsage(engineId: EngineId, model: string, tokens: TokenUsage): Promise<void> {
    try {
      await this.dayUsage.add({ engineId, model }, tokens);
    } catch (error) {
      this.logger.error(`Keeping the day's use failed: ${messageOf(error)}`);
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
