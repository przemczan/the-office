import { Injectable } from "@nestjs/common";
import { EngineModels, NoEngineListed } from "../../engine/index.js";
import {
  engineInCascade,
  roleEngineCascade,
  type EngineInCascade,
  type RoleEngineCascade,
  type WorkCascadeLevels,
} from "../domain/engine-cascade.js";
import { KnownProjectLevels } from "../ports/known-project-levels.js";
import { KnownWorkLevels } from "../ports/known-work-levels.js";
import { RoleCards } from "./role-cards.js";

/**
 * Where a session runs: in a Project or in none, and about a Task (whose Initiative's engine comes
 * with it) or an Initiative, or neither. A Task's id wins over an Initiative's.
 */
export interface EngineCascadeLocation {
  readonly projectId?: string;
  readonly taskId?: string;
  readonly initiativeId?: string;
}

/** Resolves the engine cascade (spec §5.4) for every session The Office starts. */
@Injectable()
export class EngineCascade {
  constructor(
    private readonly roleCards: RoleCards,
    private readonly engineModels: EngineModels,
    private readonly projects: KnownProjectLevels,
    private readonly work: KnownWorkLevels,
  ) {}

  /**
   * The engine and model a session of the Role `roleKey` runs on at `location`: in no Project and
   * about nothing, the Office levels only. Throws RoleNotFound when nobody fills the Role, and
   * NoEngineListed, in words, while no engine is listed.
   */
  async of(roleKey: string, location: EngineCascadeLocation = {}): Promise<EngineInCascade> {
    const applying = await this.applying(roleKey, location);
    if (applying === null) throw new NoEngineListed();
    return applying;
  }

  /** As `of`, but none while no engine is listed. */
  async applying(
    roleKey: string,
    { projectId, taskId, initiativeId }: EngineCascadeLocation = {},
  ): Promise<EngineInCascade | null> {
    const { card } = await this.roleCards.forNewSession(roleKey);
    return engineInCascade(roleKey, {
      officeDefault: await this.engineModels.officeDefault(),
      roleOverride: card.roleOverride,
      project: projectId === undefined ? undefined : await this.projects.engineLevelsOf(projectId),
      work: await this.workLevels(taskId, initiativeId),
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

  private async workLevels(
    taskId: string | undefined,
    initiativeId: string | undefined,
  ): Promise<WorkCascadeLevels | undefined> {
    if (taskId !== undefined) return this.work.engineLevelsOf({ taskId });
    if (initiativeId !== undefined) return this.work.engineLevelsOf({ initiativeId });
    return undefined;
  }
}
