import { Injectable, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EngineAdded, EngineRemoved, type EngineId } from "../../engine/index.js";
import { WorkSettings } from "../ports/work-settings.js";

/**
 * Forgets a removed engine's caps, set for its account, not the replacement's. Forgotten again when
 * an engine is added under an id it frees (Engine gives it back to an engine added again under its
 * name), so that engine starts on the defaults, whatever a save meanwhile kept.
 */
@Injectable()
export class RemovedEngineCaps implements OnModuleInit {
  constructor(
    private readonly events: EventBus,
    private readonly settings: WorkSettings,
  ) {}

  onModuleInit(): void {
    this.events.subscribe(EngineRemoved, ({ engineId }) => this.forget(engineId));
    this.events.subscribe(EngineAdded, ({ engineId }) => this.forget(engineId));
  }

  private forget(engineId: EngineId): Promise<void> {
    return this.settings.forgetEngineCaps(engineId);
  }
}
