import { Injectable } from "@nestjs/common";
import { EngineModels } from "../../engine/index.js";
import {
  engineInCascade,
  roleEngineCascade,
  type EngineInCascade,
  type RoleEngineCascade,
} from "../domain/engine-cascade.js";
import { KnownProjectLevels } from "../ports/known-project-levels.js";
import { RoleCards } from "./role-cards.js";

/** Resolves the engine cascade (spec §5.4) for every session The Office starts. */
@Injectable()
export class EngineCascade {
  constructor(
    private readonly roleCards: RoleCards,
    private readonly engineModels: EngineModels,
    private readonly projects: KnownProjectLevels,
  ) {}

  /**
   * The engine and model the Role `roleKey` runs on in the Project `projectId`, or in no Project
   * (the Office levels only). Throws RoleNotFound when nobody fills the Role.
   */
  async of(roleKey: string, projectId?: string): Promise<EngineInCascade> {
    const { card } = await this.roleCards.forNewSession(roleKey);
    return engineInCascade(roleKey, {
      officeDefault: await this.engineModels.officeDefault(),
      roleOverride: card.roleOverride,
      project: projectId === undefined ? undefined : await this.projects.engineLevelsOf(projectId),
    });
  }

  /**
   * What the Role `roleKey` runs on outside any Project, and the Projects where something else
   * applies, as its card says. Throws RoleNotFound when nobody fills the Role.
   */
  async acrossProjects(roleKey: string): Promise<RoleEngineCascade> {
    const { card } = await this.roleCards.forNewSession(roleKey);
    return roleEngineCascade(
      roleKey,
      { officeDefault: await this.engineModels.officeDefault(), roleOverride: card.roleOverride },
      await this.projects.engineLevelsOfEveryProject(),
    );
  }
}
