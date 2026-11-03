import { Injectable, type OnModuleInit } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  EngineReferenceMoves,
  movedEngineModel,
  movedEngineReference,
  type EngineModel,
  type EngineRemoval,
  type MovedEngineReference,
} from "../../engine/index.js";
import type { Role } from "../domain/role.js";
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
    this.referenceMoves.register({
      movesOf: (removal) => this.roleOverrideMovesOf(removal),
      move: (removal) => this.moveRoleOverrides(removal),
    });
  }

  async roleOverrideMovesOf(removal: EngineRemoval): Promise<MovedEngineReference[]> {
    return (await this.rolesNaming(removal.engineId)).flatMap(({ key, card }) =>
      card.roleOverride
        ? movedEngineReference(card.roleOverride, removal, { roleKey: key, project: null })
        : [],
    );
  }

  async moveRoleOverrides(removal: EngineRemoval): Promise<void> {
    const move = (reference: EngineModel) => movedEngineModel(reference, removal);
    for (const { key } of await this.rolesNaming(removal.engineId)) {
      const { event } = await this.repository.update(key, (role) =>
        moveRoleOverride(role, move, new Date()),
      );
      if (event) await this.events.publish(event);
    }
  }

  /** Every Role, let go or not, whose Role override names the engine. */
  private async rolesNaming(engineId: string): Promise<Role[]> {
    return (await this.repository.list()).filter(
      ({ card }) => card.roleOverride?.engineId === engineId,
    );
  }
}
