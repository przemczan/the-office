import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { UsageWindowsChanged } from "../domain/engine-events.js";
import { sameUsageWindows, type UsageWindows } from "../domain/usage-windows.js";

/** The account's usage windows as last read, Office-wide: every session shares them. */
@Injectable()
export class UsageWindowState {
  private windows: UsageWindows | undefined;

  constructor(private readonly events: EventBus) {}

  /** Undefined until the first read. */
  get current(): UsageWindows | undefined {
    return this.windows;
  }

  /** Keeps what was read, and announces it when it differs from what was known. */
  async update(windows: UsageWindows): Promise<void> {
    if (this.windows !== undefined && sameUsageWindows(this.windows, windows)) return;
    this.windows = windows;
    await this.events.publish(new UsageWindowsChanged(windows));
  }
}
