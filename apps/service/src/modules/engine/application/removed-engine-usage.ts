import { Injectable, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EngineAdded, EngineRemoved } from "../domain/engine-events.js";
import type { EngineId } from "../domain/engines.js";
import { DayUsage } from "./day-usage.js";
import { UsageWindowSamples } from "./usage-window-samples.js";
import { UsageWindowState } from "./usage-window-state.js";

/**
 * Forgets what a removed engine's account used: its day usage, its window reading, and its pairs
 * of readings with the ratios they give. Not moved to the replacement, another account or API
 * endpoint whose caps and ratios it would skew. Forgotten again when an engine is added under an
 * id it frees (`engineIdFor` gives it back to an engine added again under its name), as a session
 * finishing on the removed engine adds its turns after the removal.
 */
@Injectable()
export class RemovedEngineUsage implements OnModuleInit {
  constructor(
    private readonly events: EventBus,
    private readonly dayUsage: DayUsage,
    private readonly windowSamples: UsageWindowSamples,
    private readonly usageWindows: UsageWindowState,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(EngineRemoved, ({ engineId }) => this.forget(engineId));
    this.events.subscribe(EngineAdded, ({ engineId }) => this.forget(engineId));
  }

  private async forget(engineId: EngineId): Promise<void> {
    this.usageWindows.forget(engineId);
    await this.windowSamples.forget(engineId);
    await this.dayUsage.forget(engineId);
  }
}
