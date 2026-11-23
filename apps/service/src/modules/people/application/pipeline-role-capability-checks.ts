import { Injectable, type OnModuleInit } from "@nestjs/common";
import { readEach } from "../../../platform/database/fan-out.js";
import {
  EngineModels,
  EngineSessions,
  EngineSettingsChecks,
  standInListWithout,
  type Engine,
  type EngineCapability,
  type EngineCascadeSettings,
  type EngineId,
  type EngineModel,
  type EngineSettingsSave,
} from "../../engine/index.js";
import {
  isOverridden,
  movedProjectLevels,
  standInsApplying,
  type ProjectCascadeLevels,
  type ProjectDefaultEngine,
  type ProjectWithCascadeLevels,
  type WorkCascadeLevels,
} from "../domain/engine-cascade.js";
import {
  incapableEngineProblems,
  newlyOnIncapableEngines,
  rolesOnIncapableEngines,
} from "../domain/pipeline-role-capabilities.js";
import type { DutyKey } from "../domain/duties.js";
import {
  dutyNamedAnywhere,
  mergedRolesNamed,
  namedWhere,
  NO_PIPELINE_ROLES,
  rolesNamedIn,
  withDutiesResolved,
  type PipelineRolesNamed,
  type RolesAndDuties,
} from "../domain/pipeline-roles-named.js";
import { KnownProjectLevels } from "../ports/known-project-levels.js";
import { KnownWorkLevels, type TaskOnWorkLevels } from "../ports/known-work-levels.js";
import { ProjectLevelsSaves, type ProjectLevelsSave } from "../ports/project-levels-saves.js";
import { DutyChangeChecks, type DutyHolderSave } from "./duty-change-checks.js";
import { Duties } from "./duties.js";
import { PipelineRoleSources } from "./pipeline-role-sources.js";
import { RoleCards } from "./role-cards.js";

/**
 * The Roles Agent Stages name, each duty's holder among them, the Office levels of the cascade for
 * them (the Office default and the Office's Stand-in Engine list), and the engines listed.
 */
interface OfficeCascade {
  readonly rolesNamed: PipelineRolesNamed;
  /** Each duty's holder, by whom a Task's Stages naming the duty are weighed. */
  readonly holders: ReadonlyMap<DutyKey, string>;
  readonly officeDefault: EngineModel | null;
  readonly officeStandIns: readonly EngineId[];
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
  /**
   * For a Task's own Stages: the Task, and whom its Agent Stages name before the save and after.
   * While the Task or its Initiative has an engine override, its sessions run there rather than at
   * its Project's default, so the Roles it newly names are weighed at the override alone instead.
   */
  readonly task?: TaskStagesSave;
}

/** A save of a Task's own Stages: whom they name before it and after. */
export interface TaskStagesSave {
  readonly taskId: string;
  readonly before: RolesAndDuties;
  readonly after: RolesAndDuties;
}

/**
 * A change of the engine Tasks run on, a Task's or its Initiative's (spec 5.4.5), in a place named
 * in words ("On “<Task>”", "In <Initiative>"), and for each open Task it moves, whom its Agent
 * Stages name and its work levels before and after.
 */
export interface WorkLevelsChange {
  readonly place: string;
  readonly tasks: readonly WorkLevelsMove[];
}

/**
 * One open Task the change moves: whom its Agent Stages name after the change, in its Project, at
 * its levels.
 */
export interface WorkLevelsMove extends RolesAndDuties {
  /** Whom they name before, when the change chooses the Task's Pipeline; the same otherwise. */
  readonly namedBefore?: RolesAndDuties;
  readonly projectId: string;
  readonly before: WorkCascadeLevels;
  readonly after: WorkCascadeLevels;
  /** In an Initiative's change, the Task's title, which its refusal names ("… need on “<Task>”"). */
  readonly taskTitle?: string;
}

/** One Task's sessions on either side of a change: whom it names and at which levels. */
interface TaskSide {
  readonly roleKeys: ReadonlySet<string>;
  readonly work: WorkCascadeLevels;
}

/** One Task weighed in its Project, before a change and after. */
interface TaskWeighed {
  readonly projectId: string;
  readonly taskTitle?: string;
  readonly before: TaskSide;
  readonly after: TaskSide;
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
 * lacking what its Agent Stages need (spec §5.4.5), the cascade's engine or a Stand-in Engine of the
 * list that applies in the place, which may take over any session there (refused as "<engine>
 * can't stand in: …"). It registers with each level's save as it
 * starts: the Office default's and list's (Settings › Engines) and a Project's levels'; and with each duty
 * change, which moves the Stages naming the duty to its new holder. The other way round,
 * Pipelines asks it about the Roles and duties a save of Stages newly names. A Stage naming a duty
 * counts as naming its holder's Role (`withDutiesResolved`). Each save is also weighed at every open
 * Task with an engine override, or whose Initiative has one (`workLevelsProblems`). A person names no
 * engine, so no save of a Role card nor a hire is weighed.
 */
@Injectable()
export class PipelineRoleCapabilityChecks implements OnModuleInit {
  constructor(
    private readonly roleCards: RoleCards,
    private readonly engineModels: EngineModels,
    private readonly engineSessions: EngineSessions,
    private readonly pipelineRoleSources: PipelineRoleSources,
    private readonly projects: KnownProjectLevels,
    private readonly work: KnownWorkLevels,
    private readonly projectLevelsSaves: ProjectLevelsSaves,
    private readonly engineSettingsChecks: EngineSettingsChecks,
    private readonly duties: Duties,
    private readonly dutyChangeChecks: DutyChangeChecks,
  ) {}

  onModuleInit(): void {
    this.projectLevelsSaves.register((save) => this.projectLevelsSaveProblems(save));
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
    return this.newlyIncapableProblems(
      await this.officeCascade(named, holders),
      await this.officeCascade(named, new Map([...holders, [duty, to]])),
      await this.everyPlace(),
    );
  }

  /**
   * Only the saved Project's sessions change, so only it is weighed; and only its default's account
   * and the Stand-in Engine list that applies in it name engines, so a save leaving both as they are
   * (the force, the settings for people, a list kept unused) never is. Turning its own list on
   * weighs that list, turning it off the Office's.
   */
  async projectLevelsSaveProblems({
    projectId,
    projectName,
    before,
    after,
  }: ProjectLevelsSave): Promise<readonly string[]> {
    const office = await this.officeCascadeNow();
    const listBefore = standInsApplying(office.officeStandIns, before);
    const listAfter = standInsApplying(office.officeStandIns, after);
    const sameList =
      listBefore.from === listAfter.from &&
      listBefore.engineIds.length === listAfter.engineIds.length &&
      listBefore.engineIds.every((engineId, at) => listAfter.engineIds[at] === engineId);
    if (before.default?.engineId === after.default?.engineId && sameList) return [];
    return this.newlyIncapableProblems(office, office, [{ projectId, projectName, before, after }]);
  }

  /**
   * The Office default and the engines change every Role's sessions everywhere, and the Office's
   * Stand-in Engine list those outside any Project and in every Project not using its own; each
   * side is weighed on its own engines, so a rename or a switch saved with it counts. A removal also
   * moves the Projects' levels and own lists naming the engine, weighed as moved; the
   * Tasks' and Initiatives' engines it moves are weighed by Work's own check of the removal, so
   * here a Task stays at the levels it has, which name no listed engine once moved.
   */
  async engineSettingsSaveProblems({
    before,
    after,
    removal,
  }: EngineSettingsSave): Promise<readonly string[]> {
    const office = await this.officeCascadeNow();
    const move = (reference: ProjectDefaultEngine): ProjectDefaultEngine | null => {
      if (!removal || reference.engineId !== removal.engineId) return reference;
      const { replacement } = removal;
      return replacement && { engineType: replacement.kind, engineId: replacement.id };
    };
    const moveStandIns =
      removal &&
      ((standIns: readonly EngineId[]) =>
        standInListWithout(standIns, removal.engineId, removal.replacement?.id ?? null));
    const sideOf = (settings: EngineCascadeSettings): OfficeCascade => ({
      ...office,
      officeDefault: settings.officeDefault,
      officeStandIns: settings.standInEngines,
      engines: settings.engines,
    });
    return this.newlyIncapableProblems(
      sideOf(before),
      sideOf(after),
      (await this.everyPlace()).map((place) => ({
        ...place,
        after: place.after && movedProjectLevels(place.after, move, moveStandIns),
      })),
    );
  }

  /**
   * Roles newly named in Agent Stages are weighed where their sessions would run: a Task's in its
   * Project, the library's outside any Project and in every Project. A Role other Stages already
   * name in a place passed the check there. A duty is weighed by its holder's Role. A Task's own
   * Stages on a Task or Initiative with an engine override are weighed at the override alone
   * (`taskStagesProblems`). A Pipeline's Roles are also weighed at each open Task in the place with
   * an engine override, as
   * though it named them, whichever Pipeline it follows.
   */
  async newlyNamedRolesProblems({
    roleKeys,
    dutyKeys = [],
    projectId,
    task,
  }: NewlyNamedRoles): Promise<readonly string[]> {
    if (task !== undefined && projectId !== undefined) {
      const work = await this.work.engineLevelsOf({ taskId: task.taskId });
      if (isOverridden(work)) return this.taskStagesProblems(projectId, task, work);
    }
    if (roleKeys.length === 0 && dutyKeys.length === 0) return [];
    const holders = await this.duties.holders();
    const named = await this.pipelineRoleSources.rolesNamed();
    const newlyNamed = {
      ...namedWhere(roleKeys, projectId),
      duties: namedWhere(dutyKeys, projectId),
    };
    const after = await this.officeCascade(mergedRolesNamed(named, newlyNamed), holders);
    const places =
      projectId === undefined
        ? await this.everyPlace()
        : (await this.projects.engineLevelsOfEveryProject())
            .filter((project) => project.projectId === projectId)
            .map(unchangedPlace);
    return this.newlyIncapableProblems(
      { ...after, rolesNamed: withDutiesResolved(named, holders) },
      after,
      places,
      task === undefined ? withDutiesResolved(newlyNamed, holders) : NO_PIPELINE_ROLES,
    );
  }

  /**
   * A change of Tasks' engines moves only those Tasks' sessions: for each, the Roles its Agent
   * Stages name, at the Office levels, its Project's and its work levels before and after; a
   * change choosing its Pipeline also names other Roles after than before. Each Role newly on an
   * incapable engine is named once, however many Tasks it runs on.
   */
  async workLevelsChangeProblems({ place, tasks }: WorkLevelsChange): Promise<readonly string[]> {
    if (tasks.length === 0) return [];
    const holders = await this.duties.holders();
    return this.tasksProblems(
      tasks.map(({ projectId, roleKeys, dutyKeys, namedBefore, before, after, taskTitle }) => {
        const named = rolesOf({ roleKeys, dutyKeys }, holders);
        return {
          projectId,
          ...(taskTitle !== undefined && { taskTitle }),
          before: { roleKeys: namedBefore ? rolesOf(namedBefore, holders) : named, work: before },
          after: { roleKeys: named, work: after },
        };
      }),
      place,
    );
  }

  /**
   * A Task's own Stages saved while it runs at its work levels: whom they newly name there, "On
   * “<Task>”".
   */
  private async taskStagesProblems(
    projectId: string,
    { taskId, before, after }: TaskStagesSave,
    work: WorkCascadeLevels,
  ): Promise<readonly string[]> {
    const holders = await this.duties.holders();
    const onTask = (await this.work.openTasksOnWorkLevels()).find((task) => task.taskId === taskId);
    return this.tasksProblems(
      [
        {
          projectId,
          before: { roleKeys: rolesOf(before, holders), work },
          after: { roleKeys: rolesOf(after, holders), work },
        },
      ],
      onTask?.place,
    );
  }

  /**
   * What each Task's `after` puts on an incapable engine that its `before` didn't, in its Project;
   * named in `place`, with the Task's title where it has one, or each Project by its name.
   */
  private async tasksProblems(
    tasks: readonly TaskWeighed[],
    place?: string,
  ): Promise<readonly string[]> {
    const officeDefault = await this.engineModels.officeDefault();
    const officeStandIns = (await this.engineModels.standIns()).standInEngines;
    const engines = await this.engineModels.engines();
    const projects = await this.projects.engineLevelsOfEveryProject();
    const onIncapableEngines = (side: TaskSide, project: ProjectCascadeLevels | undefined) =>
      rolesOnIncapableEngines(
        side.roleKeys,
        { officeDefault, officeStandIns, project, work: side.work },
        (engineId) => this.missingCapabilitiesAmong(engines, engineId),
      );
    const found = tasks.map(({ projectId, taskTitle, before, after }) => {
      const project = projects.find((each) => each.projectId === projectId);
      return {
        projectName: project?.projectName,
        found: newlyOnIncapableEngines(
          onIncapableEngines(before, project),
          onIncapableEngines(after, project),
        ).map((each) => (taskTitle === undefined ? each : { ...each, taskTitle })),
      };
    });
    const names = {
      roleTitle: (roleKey: string) => this.roleCards.roleTitle(roleKey),
      engineName: (engineId: string) => engines.find(({ id }) => id === engineId)?.name ?? engineId,
    };
    if (place !== undefined) {
      return incapableEngineProblems(
        found.flatMap((each) => each.found),
        {
          ...names,
          projectName: undefined,
          place,
        },
      );
    }
    const projectNames = [...new Set(found.map(({ projectName }) => projectName))];
    return projectNames.flatMap((projectName) =>
      incapableEngineProblems(
        found.filter((each) => each.projectName === projectName).flatMap((each) => each.found),
        { ...names, projectName },
      ),
    );
  }

  /**
   * In each place, what `after` puts on an incapable engine that `before` didn't, named by `after`;
   * then the same at each open Task in a Project weighed that has an engine override
   * (`workLevelsProblems`).
   */
  private async newlyIncapableProblems(
    before: OfficeCascade,
    after: OfficeCascade,
    places: readonly Place[],
    namedByEveryTask: PipelineRolesNamed = NO_PIPELINE_ROLES,
  ): Promise<string[]> {
    return [
      ...this.placesProblems(before, after, places),
      ...(await this.workLevelsProblems(before, after, places, namedByEveryTask)),
    ];
  }

  private placesProblems(
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
        rolesNamedIn(office.rolesNamed, projectId),
        { officeDefault: office.officeDefault, officeStandIns: office.officeStandIns, project },
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

  /**
   * A Task with an engine override, or whose Initiative has one, runs its sessions there rather
   * than at its Project's default (spec 5.4.5), so a save above it is weighed at its levels too: by
   * the Roles its Agent Stages name that the save weighs in the place, and after it those
   * `namedByEveryTask` names in its Project; each side at its own Office levels and Project levels;
   * "On “<Task>”". Only its override is weighed: it uses no Stand-in Engine (`standInsApplying`).
   */
  private async workLevelsProblems(
    before: OfficeCascade,
    after: OfficeCascade,
    places: readonly Place[],
    namedByEveryTask: PipelineRolesNamed,
  ): Promise<string[]> {
    const tasks = (await this.work.openTasksOnWorkLevels()).flatMap((task) => {
      const place = places.find(({ projectId }) => projectId === task.projectId);
      return place === undefined ? [] : [{ task, place }];
    });
    const problems = await readEach(tasks, async ({ task, place }) => {
      const named = await this.pipelineRoleSources.rolesNamedByTask(task.taskId);
      const onIncapableEngines = (
        office: OfficeCascade,
        project: ProjectCascadeLevels | undefined,
        alsoNamed: ReadonlySet<string>,
      ) =>
        rolesOnIncapableEngines(
          taskRolesIn(office, task, new Set([...rolesOf(named, office.holders), ...alsoNamed])),
          {
            officeDefault: office.officeDefault,
            officeStandIns: office.officeStandIns,
            project,
            work: task.work,
          },
          (engineId) => this.missingCapabilitiesAmong(office.engines, engineId),
        );
      return incapableEngineProblems(
        newlyOnIncapableEngines(
          onIncapableEngines(before, place.before, new Set()),
          onIncapableEngines(after, place.after, rolesNamedIn(namedByEveryTask, task.projectId)),
        ),
        {
          roleTitle: (roleKey) => this.roleCards.roleTitle(roleKey),
          engineName: (engineId) =>
            after.engines.find(({ id }) => id === engineId)?.name ?? engineId,
          projectName: place.projectName,
          place: task.place,
        },
      );
    });
    return problems.flat();
  }

  /** What the engine lacks; an engine not listed is left to other checks. */
  private missingCapabilitiesAmong(
    engines: readonly Engine[],
    engineId: string,
  ): readonly EngineCapability[] {
    const engine = engines.find(({ id }) => id === engineId);
    return engine ? this.engineSessions.missingCapabilitiesOf(engine) : [];
  }

  /** The Office levels for the Roles Agent Stages name now, each duty by its holder's Role. */
  private async officeCascadeNow(): Promise<OfficeCascade> {
    return this.officeCascade(
      await this.pipelineRoleSources.rolesNamed(),
      await this.duties.holders(),
    );
  }

  /** The Office levels for the Roles `named` names, each duty by its holder's Role in `holders`. */
  private async officeCascade(
    named: PipelineRolesNamed,
    holders: ReadonlyMap<DutyKey, string>,
  ): Promise<OfficeCascade> {
    const rolesNamed = withDutiesResolved(named, holders);
    return {
      rolesNamed,
      holders,
      officeDefault: await this.engineModels.officeDefault(),
      officeStandIns: (await this.engineModels.standIns()).standInEngines,
      engines: await this.engineModels.engines(),
    };
  }

  /** Outside any Project, then every Project, whose levels a save of another level leaves as they are. */
  private async everyPlace(): Promise<Place[]> {
    const projects = await this.projects.engineLevelsOfEveryProject();
    return [OUTSIDE_ANY_PROJECT, ...projects.map(unchangedPlace)];
  }
}

/** The Roles a Task names among those the save weighs where its sessions run. */
function taskRolesIn(
  office: OfficeCascade,
  { projectId }: Pick<TaskOnWorkLevels, "projectId">,
  named: ReadonlySet<string>,
): string[] {
  const weighed = rolesNamedIn(office.rolesNamed, projectId);
  return [...named].filter((roleKey) => weighed.has(roleKey));
}

/** The Roles named, each duty by its holder's Role; a duty nobody holds names none. */
function rolesOf(
  { roleKeys, dutyKeys }: RolesAndDuties,
  holders: ReadonlyMap<DutyKey, string>,
): ReadonlySet<string> {
  return new Set([
    ...roleKeys,
    ...dutyKeys.flatMap((duty) => {
      const holder = holders.get(duty);
      return holder === undefined ? [] : [holder];
    }),
  ]);
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
