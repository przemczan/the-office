import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { UsageWindowsChanged } from "../domain/engine-events.js";
import {
  sameUsageWindows,
  type BegunUsageWindows,
  type UsageWindows,
} from "../domain/usage-windows.js";
import type { TokenUsage } from "../ports/session-events.js";

/**
 * The usage windows as read at one moment, with the Office's tokens so far on the engines with
 * windows, so what one run used of a window can be told from what the rest of The Office used.
 */
export interface UsageWindowReading extends UsageWindows {
  readonly readAt: Date;
  /** Since the service started, every turn of every session on an engine with windows. */
  readonly officeTokensSoFar: TokenUsage;
}

/** A reading whose windows have both begun, the only kind that shows what a run used. */
export type BegunUsageWindowReading = UsageWindowReading & BegunUsageWindows;

/** The account's usage windows as last read, Office-wide: every session shares them. */
@Injectable()
export class UsageWindowState {
  private reading: UsageWindowReading | undefined;

  constructor(private readonly events: EventBus) {}

  /** Undefined until the first read; kept in memory only, so a restart forgets it. */
  get current(): UsageWindowReading | undefined {
    return this.reading;
  }

  /** Keeps every reading, and announces one whose windows differ from what was known. */
  async update(reading: UsageWindowReading): Promise<void> {
    const previous = this.reading;
    this.reading = reading;
    if (previous !== undefined && sameUsageWindows(previous, reading)) return;
    await this.events.publish(new UsageWindowsChanged(reading));
  }
}
