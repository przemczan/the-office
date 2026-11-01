import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { UsageWindowsChanged, UsageWindowsRead } from "../domain/engine-events.js";
import { hasUsageWindows, type EngineId } from "../domain/engines.js";
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

/** The account's usage windows as last read, Office-wide: every session shares them. */
@Injectable()
export class UsageWindowState {
  private reading: UsageWindowReading | undefined;

  constructor(private readonly events: EventBus) {}

  /** Undefined until the first read; kept in memory only, so a restart forgets it. */
  get current(): UsageWindowReading | undefined {
    return this.reading;
  }

  /** The reading of the account `engineId` spends on; undefined on one without windows. */
  of(engineId: EngineId): UsageWindowReading | undefined {
    return hasUsageWindows(engineId) ? this.reading : undefined;
  }

  /** Keeps every reading and announces it, and a change when its windows differ from what was known. */
  async update(reading: UsageWindowReading): Promise<void> {
    const previous = this.reading;
    this.reading = reading;
    if (previous === undefined || !sameUsageWindows(previous, reading)) {
      await this.events.publish(new UsageWindowsChanged(reading));
    }
    await this.events.publish(new UsageWindowsRead(reading, reading.readAt));
  }
}
