import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EngineModels, EngineReferenceLock } from "../../engine/index.js";
import { engineSettingsMovedOver } from "../domain/role-changes.js";
import type { RoleCardChanged } from "../domain/role-events.js";
import { RoleRepository } from "../ports/role-repository.js";

/**
 * Moves each Role card's earlier Role override and effort over to its engine settings, once, as the
 * service starts after the update that brings them (spec §5.4.5, "Moving the earlier engine
 * settings over"): each Role whose card has none yet, people let go and the Caretaker included,
 * gets one new version naming no user. A Role moved over is never touched again, so a crash
 * halfway is made good at the next start.
 */
@Injectable()
export class EngineSettingsMoveOver implements OnApplicationBootstrap {
  private readonly logger = new Logger(EngineSettingsMoveOver.name);

  constructor(
    private readonly repository: RoleRepository,
    private readonly engineModels: EngineModels,
    private readonly engineReferences: EngineReferenceLock,
    private readonly events: EventBus,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.moveOver();
    } catch (error) {
      this.logger.error(
        "Moving the earlier engine settings over failed; the next start tries again.",
        error,
      );
    }
  }

  /**
   * Moves every Role not moved yet, under Engine's `EngineReferenceLock` from reading the engines
   * through the last save, so an engine removed meanwhile never decides a type; announces each
   * after.
   */
  async moveOver(): Promise<void> {
    const events = await this.engineReferences.holding(async () => {
      const keys = await this.repository.rolesToMoveOver();
      if (keys.length === 0) return [];
      const engines = await this.engineModels.engines();
      const moved: RoleCardChanged[] = [];
      for (const key of keys) {
        const { event } = await this.repository.moveOver(key, (role, earlier) =>
          engineSettingsMovedOver(role, earlier, engines, new Date()),
        );
        if (event) moved.push(event);
      }
      return moved;
    });
    for (const event of events) await this.events.publish(event);
  }
}
