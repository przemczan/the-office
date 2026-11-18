import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Schedule, type Wait } from "../../../platform/schedule/schedule.js";
import {
  UsageWindowReset,
  UsageWindowsChanged,
  UsageWindowsRead,
  UsageWindowUsedUp,
} from "../domain/engine-events.js";
import type { Engine, EngineId } from "../domain/engines.js";
import { sameUsageWindows, showsFree, type UsageWindows } from "../domain/usage-windows.js";
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
  /** Each used-up window, with when it was found used up, so only a later reading resets it early. */
  private readonly usedUp = new Map<
    EngineId,
    UsedUpUsageWindow & { readonly since: Date; readonly reset: Wait }
  >();
  /** Until when each engine's readings count as not free, after a refusal they didn't show. */
  private readonly holds = new Map<EngineId, Date>();

  constructor(
    private readonly events: EventBus,
    private readonly schedule: Schedule,
  ) {}

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
   * differ from what was known. A reading taken after a window was used up that shows the engine
   * free resets the window at once, as its reset time would.
   */
  async update(engine: Pick<Engine, "id" | "name">, reading: UsageWindowReading): Promise<void> {
    const previous = this.readings.get(engine.id);
    this.readings.set(engine.id, reading);
    if (previous === undefined || !sameUsageWindows(previous, reading)) {
      await this.events.publish(new UsageWindowsChanged(engine.id, engine.name, reading));
    }
    const free = this.showsFree(engine.id, reading);
    if (free) await this.resetEarly(engine.id, reading.readAt);
    await this.events.publish(new UsageWindowsRead(engine.id, reading, reading.readAt, free));
  }

  /**
   * Whether `reading` shows `engineId` free: every window below 100%, and no refused turn holding
   * the engine for a limit the readings don't show.
   */
  private showsFree(engineId: EngineId, reading: UsageWindows): boolean {
    const heldUntil = this.holds.get(engineId);
    const held = heldUntil !== undefined && heldUntil > this.schedule.now();
    return !held && showsFree(reading);
  }

  /**
   * Whether `engineId`'s latest reading shows it free, as `UsageWindowsRead` tells it, a hold
   * included; true while it hasn't been read, as nothing shows it isn't.
   */
  latestShowsFree(engineId: EngineId): boolean {
    const latest = this.readings.get(engineId);
    return latest === undefined || this.showsFree(engineId, latest);
  }

  private async resetEarly(engineId: EngineId, readAt: Date): Promise<void> {
    const usedUp = this.usedUp.get(engineId);
    if (usedUp === undefined || readAt <= usedUp.since) return;
    usedUp.reset.cancel();
    this.usedUp.delete(engineId);
    await this.events.publish(new UsageWindowReset(engineId, usedUp.window));
  }

  /** `engineId`'s used-up window while its reset is ahead; undefined otherwise. */
  usedUpUntil(engineId: EngineId): UsedUpUsageWindow | undefined {
    const usedUp = this.usedUp.get(engineId);
    if (usedUp === undefined || usedUp.until <= this.schedule.now()) return undefined;
    return { engineName: usedUp.engineName, window: usedUp.window, until: usedUp.until };
  }

  /**
   * A turn on `engine` was refused for `refused`'s window. When the engine gave no reset time, the
   * used-up window already known stands in, or else the latest reading's reset of that window, if
   * it is ahead. Announced once per engine until the reset, and again when the reset moves on; at
   * the reset, on The Office's clock, the window is announced reset. A refusal while the latest
   * reading shows the engine free is a limit the readings don't show: they count as not free until
   * its reset, so the Tasks it pauses wait for it rather than resume into another refusal.
   */
  async refused(engine: Pick<Engine, "id" | "name">, refused: UsedUpWindow): Promise<UsedUpWindow> {
    const latest = this.readings.get(engine.id);
    const unseenLimit = latest !== undefined && this.showsFree(engine.id, latest);
    const known = this.usedUpUntil(engine.id);
    const resolved: UsedUpWindow =
      known !== undefined && !refused.resetGiven
        ? { window: known.window, resetsAt: known.until, resetGiven: true }
        : this.withReadReset(engine.id, refused);
    if (unseenLimit) this.holds.set(engine.id, resolved.resetsAt);
    if (known !== undefined && known.until >= resolved.resetsAt) return resolved;
    this.usedUp.get(engine.id)?.reset.cancel();
    const reset = this.schedule.once(
      "The reset of a used-up usage window",
      resolved.resetsAt,
      () => {
        this.usedUp.delete(engine.id);
        return this.events.publish(new UsageWindowReset(engine.id, resolved.window));
      },
    );
    this.usedUp.set(engine.id, {
      engineName: engine.name,
      window: resolved.window,
      until: resolved.resetsAt,
      since: this.schedule.now(),
      reset,
    });
    await this.events.publish(
      new UsageWindowUsedUp(engine.id, engine.name, resolved.window, resolved.resetsAt),
    );
    return resolved;
  }

  private withReadReset(engineId: EngineId, refused: UsedUpWindow): UsedUpWindow {
    if (refused.resetGiven) return refused;
    const reading = this.readings.get(engineId);
    const read =
      refused.window === "five-hour"
        ? reading?.fiveHour.resetsAt
        : refused.window === "seven-day"
          ? reading?.sevenDay.resetsAt
          : undefined;
    return read !== undefined && read > this.schedule.now()
      ? { ...refused, resetsAt: read, resetGiven: true }
      : refused;
  }

  /** Drops `engineId`'s reading and used-up window, so Now no longer lists it. */
  forget(engineId: EngineId): void {
    this.readings.delete(engineId);
    this.usedUp.get(engineId)?.reset.cancel();
    this.usedUp.delete(engineId);
    this.holds.delete(engineId);
  }
}
