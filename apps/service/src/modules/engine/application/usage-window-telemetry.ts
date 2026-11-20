import { Injectable, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { Telemetry } from "../../../platform/telemetry/telemetry.js";
import { UsageWindowsRead } from "../domain/engine-events.js";
import type { UsageWindow } from "../domain/usage-windows.js";

/**
 * How full each engine's Usage windows are, recorded at each reading of them, whatever its Reading
 * source, on a Claude Code and a Codex engine alike (spec §5.2).
 */
@Injectable()
export class UsageWindowTelemetry implements OnModuleInit {
  constructor(
    private readonly events: EventBus,
    private readonly telemetry: Telemetry,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(UsageWindowsRead, (event) => this.read(event));
  }

  private read({ engineId, windows }: UsageWindowsRead): void {
    this.telemetry.recordUsageWindow(engineId, "five_hour", percentUsed(windows.fiveHour));
    this.telemetry.recordUsageWindow(engineId, "seven_day", percentUsed(windows.sevenDay));
  }
}

/** A window not begun counts as unused, so it records 0. */
function percentUsed(window: UsageWindow): number {
  return window.resetsAt === undefined ? 0 : window.percentUsed;
}
