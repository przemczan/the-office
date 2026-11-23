import { Injectable } from "@nestjs/common";
import {
  effortsTakenBy,
  EngineModels,
  NoEngineListed,
  offeredModels,
  type Effort,
  type Engine,
  type EngineKind,
} from "../../engine/index.js";
import {
  engineInCascade,
  roleEngineCascade,
  workInCascade,
  type EngineInCascade,
  type EngineInPlace,
  type LandedEngine,
  type ProjectCascadeLevels,
  type RoleEngineCascade,
  type WorkCascadeLevels,
} from "../domain/engine-cascade.js";
import type { PersonEngineSettings } from "../domain/role-card.js";
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

/** What a session brings to the model and effort cascade besides its place: a Stage's own effort. */
export interface EngineCascadeWork {
  readonly stageEffort?: Effort | null;
}

/** The engine everyone in a place runs on, its type and the level that gave it. */
export interface EngineAtPlace extends EngineInPlace {
  readonly engineType: EngineKind;
}

/** Resolves both cascades (spec §5.4.5) for every session The Office starts. */
@Injectable()
export class EngineCascade {
  constructor(
    private readonly roleCards: RoleCards,
    private readonly engineModels: EngineModels,
    private readonly projects: KnownProjectLevels,
    private readonly work: KnownWorkLevels,
  ) {}

  /**
   * The engine a session of the Role `roleKey` runs on at `location`, with the model and effort its
   * person works with there: in no Project and about nothing, the Office levels only. Throws
   * RoleNotFound when nobody fills the Role, and NoEngineListed, in words, while no engine is listed.
   */
  async of(
    roleKey: string,
    location: EngineCascadeLocation = {},
    work: EngineCascadeWork = {},
  ): Promise<EngineInCascade> {
    const applying = await this.applying(roleKey, location, work);
    if (applying === null) throw new NoEngineListed();
    return applying;
  }

  /** As `of`, but none while no engine is listed. */
  async applying(
    roleKey: string,
    { projectId, taskId, initiativeId }: EngineCascadeLocation = {},
    { stageEffort }: EngineCascadeWork = {},
  ): Promise<EngineInCascade | null> {
    const { card } = await this.roleCards.forNewSession(roleKey);
    const project =
      projectId === undefined ? undefined : await this.projects.engineLevelsOf(projectId);
    return this.resolved(roleKey, card.engineSettings, await this.engineModels.engines(), {
      project,
      work: await this.workLevels(taskId, initiativeId),
      stageEffort,
    });
  }

  /**
   * The one engine every session at `location` runs on, whatever its Role, with the level that gave
   * it; none while no engine is listed.
   */
  async engineAt({
    projectId,
    taskId,
    initiativeId,
  }: EngineCascadeLocation = {}): Promise<EngineAtPlace | null> {
    const project =
      projectId === undefined ? undefined : await this.projects.engineLevelsOf(projectId);
    const found = await this.inPlace(
      await this.engineModels.engines(),
      project,
      await this.workLevels(taskId, initiativeId),
    );
    return found && { ...found.inPlace, engineType: found.engine.kind };
  }

  /**
   * What the Role `roleKey` works with outside any Project, and the Projects where something else
   * applies, as its card says. Throws RoleNotFound when nobody fills the Role.
   */
  async acrossProjects(roleKey: string): Promise<RoleEngineCascade> {
    const { card } = await this.roleCards.forNewSession(roleKey);
    const engines = await this.engineModels.engines();
    const outsideProjects = await this.resolved(roleKey, card.engineSettings, engines, {});
    const projects = await this.projects.engineLevelsOfEveryProject();
    const inProjects = await Promise.all(
      projects.map(async (project) => ({
        projectId: project.projectId,
        applying: await this.resolved(roleKey, card.engineSettings, engines, { project }),
      })),
    );
    return roleEngineCascade(outsideProjects, inProjects);
  }

  private async resolved(
    roleKey: string,
    person: PersonEngineSettings,
    engines: readonly Engine[],
    place: {
      readonly project?: ProjectCascadeLevels;
      readonly work?: WorkCascadeLevels;
      readonly stageEffort?: Effort | null;
    },
  ): Promise<EngineInCascade | null> {
    const { project, work, stageEffort } = place;
    const found = await this.inPlace(engines, project, work);
    if (!found) return null;
    const { inPlace, engine } = found;
    return workInCascade({
      roleKey,
      engine: landed(engine),
      inPlace,
      person,
      project,
      stageEffort,
    });
  }

  /** The engine listed that everyone in the place runs on; none while no engine is listed. */
  private async inPlace(
    engines: readonly Engine[],
    project: ProjectCascadeLevels | undefined,
    work: WorkCascadeLevels | undefined,
  ): Promise<{ readonly inPlace: EngineInPlace; readonly engine: Engine } | null> {
    const inPlace = engineInCascade({
      officeDefault: await this.engineModels.officeDefault(),
      project,
      work,
    });
    const engine = inPlace && engines.find(({ id }) => id === inPlace.engineId);
    return inPlace && engine ? { inPlace, engine } : null;
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

function landed(engine: Engine): LandedEngine {
  return {
    id: engine.id,
    kind: engine.kind,
    defaultModel: engine.defaultModel,
    defaultEffort: engine.defaultEffort,
    models: offeredModels(engine),
    efforts: effortsTakenBy(engine.kind),
  };
}
