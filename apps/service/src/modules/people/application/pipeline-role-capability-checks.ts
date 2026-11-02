import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  EngineModels,
  EngineSessions,
  EngineSettingsChecks,
  type Engine,
  type EngineCapability,
  type EngineModel,
  type EngineSettingsSave,
} from "../../engine/index.js";
import type { ProjectCascadeLevels } from "../domain/engine-cascade.js";
import {
  incapableEngineProblems,
  newlyOnIncapableEngines,
  rolesOnIncapableEngines,
  type PipelineRole,
} from "../domain/pipeline-role-capabilities.js";
import { KnownPipelineRoles } from "../ports/known-pipeline-roles.js";
import { KnownProjectLevels } from "../ports/known-project-levels.js";
import { ProjectLevelsSaves, type ProjectLevelsSave } from "../ports/project-levels-saves.js";
import { RoleCards } from "./role-cards.js";
import { RoleOverrideChecks, type RoleOverrideSave } from "./role-override-checks.js";

/** The Office levels of the cascade for some Roles a Pipeline names, and the engines listed. */
interface OfficeCascade {
  readonly roles: readonly PipelineRole[];
  readonly officeDefault: EngineModel;
  readonly engines: readonly Engine[];
}

/** Where sessions run: a Project, with its levels before and after a save, or outside any. */
interface Place {
  readonly projectName: string | undefined;
  readonly before: ProjectCascadeLevels | undefined;
  readonly after: ProjectCascadeLevels | undefined;
}

const OUTSIDE_ANY_PROJECT: Place = { projectName: undefined, before: undefined, after: undefined };

/**
 * Refuses a save of the engine cascade that would newly put a Role a Pipeline names on an engine
 * lacking what its Agent Stages need (spec §5.4). It registers with each level's save as it starts:
 * the Office default's (Settings › Engines), the Role override's, and a Project's levels'.
 */
@Injectable()
export class PipelineRoleCapabilityChecks implements OnModuleInit {
  constructor(
    private readonly roleCards: RoleCards,
    private readonly engineModels: EngineModels,
    private readonly engineSessions: EngineSessions,
    private readonly pipelineRoles: KnownPipelineRoles,
    private readonly projects: KnownProjectLevels,
    private readonly projectLevelsSaves: ProjectLevelsSaves,
    private readonly roleOverrideChecks: RoleOverrideChecks,
    private readonly engineSettingsChecks: EngineSettingsChecks,
  ) {}

  onModuleInit(): void {
    this.projectLevelsSaves.register((save) => this.projectLevelsSaveProblems(save));
    this.roleOverrideChecks.register((save) => this.roleOverrideSaveProblems(save));
    this.engineSettingsChecks.register((save) => this.engineSettingsSaveProblems(save));
  }

  /** Only the saved Project's sessions change, so only it is weighed. */
  async projectLevelsSaveProblems({
    projectName,
    before,
    after,
  }: ProjectLevelsSave): Promise<readonly string[]> {
    const office = await this.officeCascade(await this.rolesNamedByPipelines());
    return this.newlyIncapableProblems(office, office, [{ projectName, before, after }]);
  }

  /** Only the saved Role's sessions change, outside any Project and in each one. */
  async roleOverrideSaveProblems({
    roleKey,
    before,
    after,
  }: RoleOverrideSave): Promise<readonly string[]> {
    if (!(await this.pipelineRoles.rolesNamed()).has(roleKey)) return [];
    const office = await this.officeCascade([]);
    return this.newlyIncapableProblems(
      { ...office, roles: [{ roleKey, roleOverride: before }] },
      { ...office, roles: [{ roleKey, roleOverride: after }] },
      await this.everyPlace(),
    );
  }

  /**
   * The Office default and the engines change every Role's sessions everywhere; each side is
   * weighed on its own engines, so a rename or a switch saved with it counts.
   */
  async engineSettingsSaveProblems({
    before,
    after,
  }: EngineSettingsSave): Promise<readonly string[]> {
    const roles = await this.rolesNamedByPipelines();
    return this.newlyIncapableProblems(
      { roles, officeDefault: before.officeDefault, engines: before.engines },
      { roles, officeDefault: after.officeDefault, engines: after.engines },
      await this.everyPlace(),
    );
  }

  /** In each place, what `after` puts on an incapable engine that `before` didn't, named by `after`. */
  private newlyIncapableProblems(
    before: OfficeCascade,
    after: OfficeCascade,
    places: readonly Place[],
  ): string[] {
    const onIncapableEngines = (office: OfficeCascade, project: ProjectCascadeLevels | undefined) =>
      rolesOnIncapableEngines(office.roles, office.officeDefault, project, (engineId) =>
        this.missingCapabilitiesAmong(office.engines, engineId),
      );
    return places.flatMap((place) =>
      incapableEngineProblems(
        newlyOnIncapableEngines(
          onIncapableEngines(before, place.before),
          onIncapableEngines(after, place.after),
        ),
        {
          roleTitle: (roleKey) => this.roleCards.roleTitle(roleKey),
          engineName: (engineId) =>
            after.engines.find(({ id }) => id === engineId)?.name ?? engineId,
          projectName: place.projectName,
        },
      ),
    );
  }

  /** What the engine lacks; an engine not listed is left to other checks. */
  private missingCapabilitiesAmong(
    engines: readonly Engine[],
    engineId: string,
  ): readonly EngineCapability[] {
    const engine = engines.find(({ id }) => id === engineId);
    return engine ? this.engineSessions.missingCapabilitiesOf(engine) : [];
  }

  private async officeCascade(roles: readonly PipelineRole[]): Promise<OfficeCascade> {
    return {
      roles,
      officeDefault: await this.engineModels.officeDefault(),
      engines: await this.engineModels.engines(),
    };
  }

  /** Outside any Project, then every Project, whose levels a save of another level leaves as they are. */
  private async everyPlace(): Promise<Place[]> {
    const projects = await this.projects.engineLevelsOfEveryProject();
    return [
      OUTSIDE_ANY_PROJECT,
      ...projects.map((project) => ({
        projectName: project.projectName,
        before: project,
        after: project,
      })),
    ];
  }

  private async rolesNamedByPipelines(): Promise<PipelineRole[]> {
    const roleKeys = [...(await this.pipelineRoles.rolesNamed())];
    return Promise.all(
      roleKeys.map(async (roleKey) => ({
        roleKey,
        roleOverride: (await this.roleCards.find(roleKey))?.card.roleOverride ?? null,
      })),
    );
  }
}
