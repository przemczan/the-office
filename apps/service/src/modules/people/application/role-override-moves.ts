import { Injectable, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  EngineReferenceMoves,
  movedEngineModel,
  type EngineModel,
  type EngineRemoval,
} from "../../engine/index.js";
import { moveRoleOverride } from "../domain/role-changes.js";
import { RoleRepository } from "../ports/role-repository.js";

/**
 * Moves each Role override naming an engine being removed to the replacement, as a new card
 * version, so the card's history shows the change. Engine's check of the removal has weighed the
 * moved overrides already, so they aren't checked again here.
 */
@Injectable()
export class RoleOverrideMoves implements OnModuleInit {
  constructor(
    private readonly repository: RoleRepository,
    private readonly events: EventBus,
    private readonly referenceMoves: EngineReferenceMoves,
  ) {}

  onModuleInit(): void {
    this.referenceMoves.register((removal) => this.moveRoleOverrides(removal));
  }

  async moveRoleOverrides(removal: EngineRemoval): Promise<void> {
    const move = (reference: EngineModel) => movedEngineModel(reference, removal);
    for (const { key, card } of await this.repository.list()) {
      if (card.roleOverride?.engineId !== removal.engineId) continue;
      const { event } = await this.repository.update(key, (role) =>
        moveRoleOverride(role, move, new Date()),
      );
      if (event) await this.events.publish(event);
    }
  }
}
