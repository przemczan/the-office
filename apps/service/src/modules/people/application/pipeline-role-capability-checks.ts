import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  EngineModels,
  EngineSessions,
  EngineSettingsChecks,
  movedEngineModel,
  type Engine,
  type EngineCapability,
  type EngineModel,
  type EngineSettingsSave,
} from "../../engine/index.js";
import {
  movedProjectLevels,
  type ProjectCascadeLevels,
  type ProjectWithCascadeLevels,
} from "../domain/engine-cascade.js";
import {
  incapableEngineProblems,
  newlyOnIncapableEngines,
  rolesOnIncapableEngines,
  type PipelineRole,
} from "../domain/pipeline-role-capabilities.js";
import type { DutyKey } from "../domain/duties.js";
import {
  dutyNamedAnywhere,
  mergedRolesNamed,
  namedWhere,
  onlyRole,
  rolesNamedAnywhere,
  rolesNamedIn,
  withDutiesResolved,
  type PipelineRolesNamed,
} from "../domain/pipeline-roles-named.js";
import { KnownProjectLevels } from "../ports/known-project-levels.js";
import { ProjectLevelsSaves, type ProjectLevelsSave } from "../ports/project-levels-saves.js";
import { DutyChangeChecks, type DutyHolderSave } from "./duty-change-checks.js";
import { Duties } from "./duties.js";
import { PipelineRoleSources } from "./pipeline-role-sources.js";
import { RoleCards } from "./role-cards.js";
import { RoleOverrideChecks, type RoleOverrideSave } from "./role-override-checks.js";

/** The Roles Agent Stages name, each duty's holder among them, the Office levels of the cascade for them, and the engines listed. */
interface OfficeCascade {
  readonly rolesNamed: PipelineRolesNamed;
  /** Each named Role's override; a Role nobody fills has none. */
  readonly roleOverrides: ReadonlyMap<string, EngineModel | null>;
  readonly officeDefault: EngineModel | null;
  readonly engines: readonly Engine[];
}

/**
 * Roles and duties a save of Stages newly names in Agent Stages, and the Project whose sessions
 * they'd run in: a Task's own Stages run in its Project; the library's anywhere (undefined).
 */
export interface NewlyNamedRoles {
  readonly roleKeys: readonly string[];
  /** Weighed by their holders; a duty nobody holds names no Role. */
  readonly dutyKeys?: readonly DutyKey[];
  readonly projectId: string | undefined;
}

/** Where sessions run: a Project, with its levels before and after a save, or outside any. */
interface Place {
  readonly projectId: string | undefined;
  readonly projectName: string | undefined;
  readonly before: ProjectCascadeLevels | undefined;
  readonly after: ProjectCascadeLevels | undefined;
}

const OUTSIDE_ANY_PROJECT: Place = {
  projectId: undefined,
  projectName: undefined,
  before: undefined,
  after: undefined,
};

/**
 * Refuses a save of the engine cascade that would newly put a Role a Pipeline names on an engine
 * lacking what its Agent Stages need (spec §5.4). It registers with each level's save as it starts:
 * the Office default's (Settings › Engines), the Role override's, and a Project's levels'; and with
 * each duty change, which moves the Stages naming the duty to its new holder. The other way round,
 * Pipelines asks it about the Roles and duties a save of Stages newly names. A Stage naming a duty
 * counts as naming its holder's Role (`withDutiesResolved`).
 */
@Injectable()
export class PipelineRoleCapabilityChecks implements OnModuleInit {
  constructor(
    private readonly roleCards: RoleCards,
    private readonly engineModels: EngineModels,
    private readonly engineSessions: EngineSessions,
    private readonly pipelineRoleSources: PipelineRoleSources,
    private readonly projects: KnownProjectLevels,
    private readonly projectLevelsSaves: ProjectLevelsSaves,
    private readonly roleOverrideChecks: RoleOverrideChecks,
    private readonly engineSettingsChecks: EngineSettingsChecks,
    private readonly duties: Duties,
    private readonly dutyChangeChecks: DutyChangeChecks,
  ) {}

  onModuleInit(): void {
    this.projectLevelsSaves.register((save) => this.projectLevelsSaveProblems(save));
    this.roleOverrideChecks.register((save) => this.roleOverrideSaveProblems(save));
    this.engineSettingsChecks.register((save) => this.engineSettingsSaveProblems(save));
    this.dutyChangeChecks.register((save) => this.dutyChangeProblems(save));
  }

  /**
   * A duty Agent Stages name moves their sessions to its new holder's Role, outside any Project and
   * in each one; setting it to none puts it on no engine.
   */
  async dutyChangeProblems({ duty, to }: DutyHolderSave): Promise<readonly string[]> {
    const named = await this.pipelineRoleSources.rolesNamed();
    if (to === null || !dutyNamedAnywhere(named, duty)) return [];
    const holders = await this.duties.holders();
    const after = withDutiesResolved(named, new Map([...holders, [duty, to]]));
    const office = await this.officeCascade(after);
    return this.newlyIncapableProblems(
      { ...office, rolesNamed: withDutiesResolved(named, holders) },
      office,
      await this.everyPlace(),
    );
  }

  /** Only the saved Project's sessions change, so only it is weighed. */
  async projectLevelsSaveProblems({
    projectId,
    projectName,
    before,
    after,
  }: ProjectLevelsSave): Promise<readonly string[]> {
    const office = await this.officeCascade(await this.rolesNamed());
    return this.newlyIncapableProblems(office, office, [{ projectId, projectName, before, after }]);
  }

  /** Only the saved Role's sessions change, outside any Project and in each one. */
  async roleOverrideSaveProblems({
    roleKey,
    before,
    after,
  }: RoleOverrideSave): Promise<readonly string[]> {
    const named = await this.rolesNamed();
    if (!rolesNamedAnywhere(named).has(roleKey)) return [];
    const office = await this.officeCascade(onlyRole(named, roleKey));
    return this.newlyIncapableProblems(
      { ...office, roleOverrides: new Map([[roleKey, before]]) },
      { ...office, roleOverrides: new Map([[roleKey, after]]) },
      await this.everyPlace(),
    );
  }

  /**
   * The Office default and the engines change every Role's sessions everywhere; each side is
   * weighed on its own engines, so a rename or a switch saved with it counts. A removal also
   * moves the Role overrides and the Projects' levels naming the engine, weighed as moved.
   */
  async engineSettingsSaveProblems({
    before,
    after,
    removal,
  }: EngineSettingsSave): Promise<readonly string[]> {
    const office = await this.officeCascade(await this.rolesNamed());
    const move = (reference: EngineModel) =>
      removal ? movedEngineModel(reference, removal) : reference;
    return this.newlyIncapableProblems(
      { ...office, officeDefault: before.officeDefault, engines: before.engines },
      {
        ...office,
        roleOverrides: new Map(
          [...office.roleOverrides].map(([roleKey, override]) => [
            roleKey,
            override && move(override),
          ]),
        ),
        officeDefault: after.officeDefault,
        engines: after.engines,
      },
      (await this.everyPlace()).map((place) => ({
        ...place,
        after: place.after && movedProjectLevels(place.after, move),
      })),
    );
  }

  /**
   * Roles newly named in Agent Stages are weighed where their sessions would run: a Task's in its
   * Project, the library's outside any Project and in every Project. A Role other Stages already
   * name in a place passed the check there. A duty is weighed by its holder's Role.
   */
  async newlyNamedRolesProblems({
    roleKeys,
    dutyKeys = [],
    projectId,
  }: NewlyNamedRoles): Promise<readonly string[]> {
    if (roleKeys.length === 0 && dutyKeys.length === 0) return [];
    const holders = await this.duties.holders();
    const named = withDutiesResolved(await this.pipelineRoleSources.rolesNamed(), holders);
    const newlyNamed = withDutiesResolved(
      { ...namedWhere(roleKeys, projectId), duties: namedWhere(dutyKeys, projectId) },
      holders,
    );
    const after = await this.officeCascade(mergedRolesNamed(named, newlyNamed));
    const places =
      projectId === undefined
        ? await this.everyPlace()
        : (await this.projects.engineLevelsOfEveryProject())
            .filter((project) => project.projectId === projectId)
            .map(unchangedPlace);
    return this.newlyIncapableProblems({ ...after, rolesNamed: named }, after, places);
  }

  /** In each place, what `after` puts on an incapable engine that `before` didn't, named by `after`. */
  private newlyIncapableProblems(
    before: OfficeCascade,
    after: OfficeCascade,
    places: readonly Place[],
  ): string[] {
    const onIncapableEngines = (
      office: OfficeCascade,
      projectId: string | undefined,
      project: ProjectCascadeLevels | undefined,
    ) =>
      rolesOnIncapableEngines(
        pipelineRolesIn(office, projectId),
        office.officeDefault,
        project,
        (engineId) => this.missingCapabilitiesAmong(office.engines, engineId),
      );
    return places.flatMap((place) =>
      incapableEngineProblems(
        newlyOnIncapableEngines(
          onIncapableEngines(before, place.projectId, place.before),
          onIncapableEngines(after, place.projectId, place.after),
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

  /** The Roles Agent Stages name now, each duty they name by its holder's Role. */
  private async rolesNamed(): Promise<PipelineRolesNamed> {
    return withDutiesResolved(
      await this.pipelineRoleSources.rolesNamed(),
      await this.duties.holders(),
    );
  }

  private async officeCascade(rolesNamed: PipelineRolesNamed): Promise<OfficeCascade> {
    return {
      rolesNamed,
      roleOverrides: await this.roleOverridesOf(rolesNamedAnywhere(rolesNamed)),
      officeDefault: await this.engineModels.officeDefault(),
      engines: await this.engineModels.engines(),
    };
  }

  /** Outside any Project, then every Project, whose levels a save of another level leaves as they are. */
  private async everyPlace(): Promise<Place[]> {
    const projects = await this.projects.engineLevelsOfEveryProject();
    return [OUTSIDE_ANY_PROJECT, ...projects.map(unchangedPlace)];
  }

  private async roleOverridesOf(
    roleKeys: ReadonlySet<string>,
  ): Promise<ReadonlyMap<string, EngineModel | null>> {
    return new Map(
      await Promise.all(
        [...roleKeys].map(
          async (roleKey) =>
            [roleKey, (await this.roleCards.find(roleKey))?.card.roleOverride ?? null] as const,
        ),
      ),
    );
  }
}

/** The Roles named where sessions run in the Project, or outside any, each with its override. */
function pipelineRolesIn(office: OfficeCascade, projectId: string | undefined): PipelineRole[] {
  return [...rolesNamedIn(office.rolesNamed, projectId)].map((roleKey) => ({
    roleKey,
    roleOverride: office.roleOverrides.get(roleKey) ?? null,
  }));
}

/** A Project whose levels a save of something else leaves as they are. */
function unchangedPlace(project: ProjectWithCascadeLevels): Place {
  return {
    projectId: project.projectId,
    projectName: project.projectName,
    before: project,
    after: project,
  };
}
