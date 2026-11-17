import { Injectable, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EngineAccountChanged } from "../domain/engine-events.js";
import { hasUsageWindows, type Engine, type EngineId } from "../domain/engines.js";
import { EngineModels } from "./engine-models.js";
import { UsageWindowSamples } from "./usage-window-samples.js";
import { UsageWindowState } from "./usage-window-state.js";

/**
 * What an engine's account change does to its usage windows (spec §5.4): its last readings are
 * forgotten, so no pair of readings spans two accounts, the pairs kept staying. A Codex engine's
 * reading and used-up window are forgotten too, so Now no longer shows them and Start no longer
 * weighs them: `EngineAccountChanged` doesn't tell an API key or a Sign out from a ChatGPT Sign in,
 * and the next turn reads the new account's windows, if it has any.
 */
@Injectable()
export class ChangedAccountUsage implements OnModuleInit {
  constructor(
    private readonly events: EventBus,
    private readonly engineModels: EngineModels,
    private readonly windowSamples: UsageWindowSamples,
    private readonly usageWindows: UsageWindowState,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(EngineAccountChanged, ({ engineId }) => this.accountChanged(engineId));
  }

  private async accountChanged(engineId: EngineId): Promise<void> {
    this.windowSamples.forgetLastReadings(engineId);
    const engine = (await this.engineModels.engines()).find(({ id }) => id === engineId);
    if (readingOutlivesChange(engine)) return;
    this.usageWindows.forget(engineId);
  }
}

/** A Claude Code account's windows are read again on its next turn, as before account changes. */
function readingOutlivesChange(engine: Engine | undefined): boolean {
  return engine !== undefined && engine.kind !== "codex" && hasUsageWindows(engine);
}
