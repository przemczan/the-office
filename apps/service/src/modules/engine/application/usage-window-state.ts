import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { UsageWindowsChanged, UsageWindowsRead } from "../domain/engine-events.js";
import type { Engine, EngineId } from "../domain/engines.js";
import { sameUsageWindows, type UsageWindows } from "../domain/usage-windows.js";
import type { TokenUsage } from "../ports/session-events.js";

/**
 * The usage windows as read at one moment, with the Office's tokens so far on the engine they were
 * read on, so what one run used of a window can be told from what the rest of The Office used.
 */
export interface UsageWindowReading extends UsageWindows {
  readonly readAt: Date;
  /** Since the service started, every turn of every session on the engine (by its engine id). */
  readonly officeTokensSoFar: TokenUsage;
}

/** Each account's usage windows as last read, by engine id, Office-wide: every session shares them. */
@Injectable()
export class UsageWindowState {
  private readonly readings = new Map<EngineId, UsageWindowReading>();

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

  /** Drops `engineId`'s reading, so Now no longer lists it. */
  forget(engineId: EngineId): void {
    this.readings.delete(engineId);
  }
}
