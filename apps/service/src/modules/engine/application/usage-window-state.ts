import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  UsageWindowReset,
  UsageWindowsChanged,
  UsageWindowsRead,
  UsageWindowUsedUp,
} from "../domain/engine-events.js";
import type { Engine, EngineId } from "../domain/engines.js";
import { sameUsageWindows, type UsageWindows } from "../domain/usage-windows.js";
import type { TokenUsage, UsageWindowName, UsedUpWindow } from "../ports/session-events.js";

/**
 * The usage windows as read at one moment, with the Office's tokens so far on the engine they were
 * read on, so what one run used of a window can be told from what the rest of The Office used.
 */
export interface UsageWindowReading extends UsageWindows {
  readonly readAt: Date;
  /** Since the service started, every turn of every session on the engine (by its engine id). */
  readonly officeTokensSoFar: TokenUsage;
}

/** A window of an engine's account the engine refuses turns for, until its reset. */
export interface UsedUpUsageWindow {
  readonly engineName: string;
  readonly window: UsageWindowName;
  readonly until: Date;
}

/**
 * Each account's usage windows as last read, by engine id, Office-wide: every session shares them;
 * and which accounts have a window used up. Both are kept in memory only (spec 5.4): after a
 * restart a used-up window is unknown until a turn is refused again.
 */
@Injectable()
export class UsageWindowState {
  private readonly readings = new Map<EngineId, UsageWindowReading>();
  private readonly usedUp = new Map<
    EngineId,
    UsedUpUsageWindow & { readonly timer: NodeJS.Timeout }
  >();

  constructor(private readonly events: EventBus) {}

  /** Every engine's latest reading, in the order each was first read; kept in memory only. */
  get readingsByEngine(): ReadonlyMap<EngineId, UsageWindowReading> {
    return this.readings;
  }

  /** The latest reading of `engineId`'s account; undefined on one without windows or not read yet. */
  of(engineId: EngineId): UsageWindowReading | undefined {
    return this.readings.get(engineId);
  }

  /**
   * Keeps every reading of `engine`'s account and announces it, and a change when its windows
   * differ from what was known.
   */
  async update(engine: Pick<Engine, "id" | "name">, reading: UsageWindowReading): Promise<void> {
    const previous = this.readings.get(engine.id);
    this.readings.set(engine.id, reading);
    if (previous === undefined || !sameUsageWindows(previous, reading)) {
      await this.events.publish(new UsageWindowsChanged(engine.id, engine.name, reading));
    }
    await this.events.publish(new UsageWindowsRead(engine.id, reading, reading.readAt));
  }

  /** `engineId`'s used-up window while its reset is ahead; undefined otherwise. */
  usedUpUntil(engineId: EngineId, now = new Date()): UsedUpUsageWindow | undefined {
    const usedUp = this.usedUp.get(engineId);
    if (usedUp === undefined || usedUp.until <= now) return undefined;
    return { engineName: usedUp.engineName, window: usedUp.window, until: usedUp.until };
  }

  /**
   * A turn on `engine` was refused for `refused`'s window. When the engine gave no reset time, the
   * latest reading's reset of that window stands in, if it is ahead. Announced once per engine until
   * the reset, and again when the reset moves on; at the reset the window is announced reset.
   */
  async refused(
    engine: Pick<Engine, "id" | "name">,
    refused: UsedUpWindow,
    now = new Date(),
  ): Promise<UsedUpWindow> {
    const resolved = this.withReadReset(engine.id, refused, now);
    const known = this.usedUp.get(engine.id);
    if (known !== undefined && known.until >= resolved.resetsAt) return resolved;
    if (known !== undefined) clearTimeout(known.timer);
    const timer = setTimeout(() => {
      this.usedUp.delete(engine.id);
      void this.events.publish(new UsageWindowReset(engine.id, resolved.window));
    }, resolved.resetsAt.getTime() - now.getTime());
    timer.unref();
    this.usedUp.set(engine.id, {
      engineName: engine.name,
      window: resolved.window,
      until: resolved.resetsAt,
      timer,
    });
    await this.events.publish(
      new UsageWindowUsedUp(engine.id, engine.name, resolved.window, resolved.resetsAt),
    );
    return resolved;
  }

  private withReadReset(engineId: EngineId, refused: UsedUpWindow, now: Date): UsedUpWindow {
    if (refused.resetGiven) return refused;
    const reading = this.readings.get(engineId);
    const read =
      refused.window === "five-hour"
        ? reading?.fiveHour.resetsAt
        : refused.window === "seven-day"
          ? reading?.sevenDay.resetsAt
          : undefined;
    return read !== undefined && read > now
      ? { ...refused, resetsAt: read, resetGiven: true }
      : refused;
  }

  /** Drops `engineId`'s reading and used-up window, so Now no longer lists it. */
  forget(engineId: EngineId): void {
    this.readings.delete(engineId);
    const usedUp = this.usedUp.get(engineId);
    if (usedUp !== undefined) clearTimeout(usedUp.timer);
    this.usedUp.delete(engineId);
  }
}
