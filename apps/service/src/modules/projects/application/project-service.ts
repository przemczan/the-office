import { isAbsolute, resolve } from "node:path";
import { Injectable, Logger } from "@nestjs/common";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { SignedInUser } from "../../../platform/http/signed-in-requests.js";
import { EngineReferenceLock, type EngineModel } from "../../engine/index.js";
import {
  projectIdFor,
  trimmedNewProject,
  type NewProject,
  type Project,
  type ProjectCommand,
  type ProjectCommandFields,
  type ProjectEngineLevels,
  type ProjectMark,
  type PublishingLine,
  type PublishingMode,
  type RunEnvironmentAnswer,
  type RunEnvironmentSetting,
} from "../domain/project.js";
import {
  addProject,
  addCommand,
  asProjectChanges,
  changeCommand,
  changeCommandsAsProposed,
  changeInstallCommand,
  changeDefaultPipeline,
  changeEnvironment,
  changeInstallInputs,
  changeMark,
  changeProjectDefault,
  changeProjectLimit,
  changePublishingLine,
  changePublishingMode,
  changeRoleOverride,
  changeRunEnvironment,
  changeUseForEveryRole,
  changeProjectSkillUse,
  changeUseProjectSkills,
  finishRunEnvironmentSetUp,
  removeCommand,
  type ProjectChange,
  type ProjectChanges,
} from "../domain/project-changes.js";
import { ProjectNotFound } from "../domain/project-not-found.js";
import { ProjectRefused } from "../domain/project-refused.js";
import { OutputMask } from "../domain/output-mask.js";
import {
  editedEnvironment,
  trimmedEnvironment,
  type ProjectEnvironmentEdit,
} from "../domain/project-environment.js";
import {
  proposedCommandsProblems,
  removedCommandKeys,
  type ProposedCommands,
} from "../domain/proposed-commands.js";
import { CLONE_REMOTE, Git } from "../ports/git.js";
import { ProjectRepository } from "../ports/project-repository.js";
import { EngineLevelsChecks } from "./engine-levels-checks.js";
import { ProjectChecks } from "./project-checks.js";
import { RunEnvironmentSetUpRegistry } from "./run-environment-set-up-registry.js";

/**
 * The Projects use cases. Each change is saved first and its event published after, so nothing
 * hears of a change that wasn't kept.
 */
/** The user's answer to the run environment question as they added a Project. */
export interface RunEnvironmentAnswered {
  readonly answer: RunEnvironmentAnswer;
  readonly by: SignedInUser;
}

@Injectable()
export class ProjectService {
  private readonly logger = new Logger(ProjectService.name);

  constructor(
    private readonly repository: ProjectRepository,
    private readonly checks: ProjectChecks,
    private readonly git: Git,
    private readonly events: EventBus,
    private readonly engineLevelsChecks: EngineLevelsChecks,
    private readonly engineReferences: EngineReferenceLock,
    private readonly runEnvironmentSetUp: RunEnvironmentSetUpRegistry,
  ) {}

  /**
   * Refuses with every reason, before saving, when the Project breaks a rule. The answer to the run
   * environment question is applied once the Project is added: a Project to onboard is added with
   * none, so it is asked at its first Start.
   */
  async add(given: NewProject, answered?: RunEnvironmentAnswered): Promise<Project> {
    const newProject = withResolvedPath(trimmedNewProject(given));
    await this.checks.checkNewProject(newProject);
    await this.trackBaseBranchOfClone(newProject);
    const takenIds = new Set((await this.repository.list()).map((project) => project.id));
    const { project, event } = addProject(
      projectIdFor(newProject.name, takenIds),
      newProject,
      new Date(),
    );
    await this.repository.add(project);
    await this.events.publish(event);
    return answered ? this.answerRunEnvironment(project, answered) : project;
  }

  /**
   * The Project is added either way: an answer that fails leaves the setting "not-decided", so the
   * question comes back at its next Start.
   */
  private async answerRunEnvironment(
    project: Project,
    { answer, by }: RunEnvironmentAnswered,
  ): Promise<Project> {
    try {
      if (answer === "no") return await this.changeRunEnvironment(project.id, "off", []);
      if (answer === "yes") {
        await this.runEnvironmentSetUp.setUp(project.id, by);
        return await this.read(project.id);
      }
    } catch (error) {
      this.logger.error(
        `The Project ${project.name}'s run environment answer wasn't applied.`,
        error,
      );
    }
    return project;
  }

  /**
   * A clone has only its default branch locally; another base branch is made from the remote's,
   * tracking it, so worktrees start from its upstream as from any base branch (spec §5.5 Defaults).
   */
  private async trackBaseBranchOfClone({
    path,
    baseBranch,
    repositoryUrl,
  }: NewProject): Promise<void> {
    if (repositoryUrl === undefined || (await this.git.hasBranch(path, baseBranch))) return;
    await this.git.trackRemoteBranch(path, { remote: CLONE_REMOTE, branch: baseBranch });
  }

  /** Every reason `add` would refuse the Project now, as a Proposal of it is judged. */
  async newProjectProblems(given: NewProject): Promise<string[]> {
    return this.checks.newProjectProblems(withResolvedPath(trimmedNewProject(given)));
  }

  async list(): Promise<readonly Project[]> {
    return this.repository.list();
  }

  async read(id: string): Promise<Project> {
    const project = await this.find(id);
    if (!project) throw new ProjectNotFound(id);
    return project;
  }

  /** The Projects of these ids that The Office knows, with their names now, for Stats. */
  async namesOf(
    ids: readonly string[],
  ): Promise<readonly { readonly projectId: string; readonly name: string }[]> {
    const wanted = new Set(ids);
    return (await this.repository.list())
      .filter(({ id }) => wanted.has(id))
      .map(({ id, name }) => ({ projectId: id, name }));
  }

  /** Undefined when there is no such Project. */
  async find(id: string): Promise<Project | undefined> {
    return this.repository.find(id);
  }

  /** The Project added from the repository at `path`, read as `add` reads it; undefined when none. */
  async findByPath(path: string): Promise<Project | undefined> {
    const repositoryPath = resolvedPath(path.trim());
    return (await this.repository.list()).find((project) => project.path === repositoryPath);
  }

  /** A worktree installs again before its next Stage, as its last install ran another line. */
  async changeInstallCommand(id: string, commandLine: string): Promise<Project> {
    return this.update(id, (project) => changeInstallCommand(project, commandLine));
  }

  async addCommand(id: string, command: ProjectCommand): Promise<Project> {
    return this.update(id, (project) => addCommand(project, command));
  }

  /** A running Task runs the new line from its next Script Stage, which reads it when it runs. */
  async changeCommand(id: string, key: string, change: ProjectCommandFields): Promise<Project> {
    return this.update(id, (project) => changeCommand(project, key, change));
  }

  /** Refused while the Project's default Pipeline runs the command (spec §2.1). */
  async removeCommand(id: string, key: string): Promise<Project> {
    await this.checks.checkCommandRemoval(await this.read(id), key);
    return this.update(id, (project) => removeCommand(project, key));
  }

  async changeInstallInputs(id: string, installInputs: readonly string[]): Promise<Project> {
    return this.update(id, (project) => changeInstallInputs(project, installInputs));
  }

  /**
   * Every reason a Proposal of commands can't apply to the Project now
   * (`proposedCommandsProblems`), or that there is no such Project.
   */
  async proposedCommandsProblems(id: string, proposed: ProposedCommands): Promise<string[]> {
    const project = await this.find(id);
    if (!project) return [new ProjectNotFound(id).message];
    return [
      ...proposedCommandsProblems(project, proposed),
      ...(await this.checks.commandRemovalProblems(project, removedCommandKeys(proposed))),
    ];
  }

  /**
   * Applies a Proposal of commands (spec §2.3) all or nothing: checked against the Project as its
   * row is held and saved in one go, so a hand edit can't land between fields. Refused while the
   * default Pipeline runs a command it removes.
   */
  async changeCommandsAsProposed(id: string, proposed: ProposedCommands): Promise<Project> {
    const removalProblems = await this.checks.commandRemovalProblems(
      await this.read(id),
      removedCommandKeys(proposed),
    );
    if (removalProblems.length > 0) throw new ProjectRefused(removalProblems);
    return this.updateTogether(id, (project) => changeCommandsAsProposed(project, proposed));
  }

  /**
   * Hides the Project's Secret variables in what its sessions write (spec §6), as it reads now; a
   * Project gone hides nothing, as nothing of it runs any more.
   */
  async outputMaskOf(id: string): Promise<OutputMask> {
    const project = await this.find(id);
    return project ? OutputMask.of(project.environment) : OutputMask.NONE;
  }

  /**
   * The user's Save of the environment (spec §5.5): a Secret variable given without a value keeps
   * the Project's. Refuses with every reason, saving nothing, when it breaks a rule.
   */
  async changeEnvironment(id: string, edit: ProjectEnvironmentEdit): Promise<Project> {
    return this.update(id, (project) => {
      const environment = trimmedEnvironment(editedEnvironment(edit, project.environment));
      const problems = this.checks.environmentProblems(environment);
      if (problems.length > 0) throw new ProjectRefused(problems);
      return changeEnvironment(project, environment);
    });
  }

  /** Publish's before or after line (spec §2.3 Defaults); blank clears it. */
  async changePublishingLine(
    id: string,
    line: PublishingLine,
    commandLine: string,
  ): Promise<Project> {
    return this.update(id, (project) => changePublishingLine(project, line, commandLine));
  }

  async changePublishingMode(id: string, publishingMode: PublishingMode): Promise<Project> {
    return this.update(id, (project) => changePublishingMode(project, publishingMode));
  }

  /**
   * The user's On or Off; On refused with `definitionProblems`, the problems of the definition on
   * the base branch, which the caller reads.
   */
  async changeRunEnvironment(
    id: string,
    runEnvironment: Exclude<RunEnvironmentSetting, "not-decided">,
    definitionProblems: readonly string[],
  ): Promise<Project> {
    return this.update(id, (project) =>
      changeRunEnvironment(project, runEnvironment, definitionProblems),
    );
  }

  /** A set-up Task is Done, with these problems of the definition on its branch. */
  async finishRunEnvironmentSetUp(
    id: string,
    definitionProblems: readonly string[],
  ): Promise<Project> {
    return this.update(id, (project) => finishRunEnvironmentSetUp(project, definitionProblems));
  }

  /** Lowering it stops no started Task: nothing new starts in the Project until enough end. */
  async changeProjectLimit(id: string, projectLimit: number): Promise<Project> {
    return this.update(id, (project) => changeProjectLimit(project, projectLimit));
  }

  async changeMark(id: string, mark: ProjectMark): Promise<Project> {
    return this.update(id, (project) => changeMark(project, mark));
  }

  /** Refused for a Pipeline running a command the Project lacks (spec §2.3). */
  async changeDefaultPipeline(id: string, defaultPipeline: string): Promise<Project> {
    await this.checks.checkDefaultPipeline({ ...(await this.read(id)), defaultPipeline });
    return this.update(id, (project) => changeDefaultPipeline(project, defaultPipeline));
  }

  /** The Project's levels of the engine cascade; throws ProjectNotFound when there is none. */
  async engineLevelsOf(id: string): Promise<ProjectEngineLevels> {
    return engineLevelsOf(await this.read(id));
  }

  /** Every Project's levels of the engine cascade, with its id and name, in the list's order. */
  async engineLevelsOfEveryProject(): Promise<
    readonly (ProjectEngineLevels & { readonly projectId: string; readonly projectName: string })[]
  > {
    return (await this.repository.list()).map((project) => ({
      projectId: project.id,
      projectName: project.name,
      ...engineLevelsOf(project),
    }));
  }

  /** Sessions already running keep the engine and model they started on. */
  async changeProjectDefault(id: string, projectDefault: EngineModel | null): Promise<Project> {
    return this.changeEngineLevels(id, projectDefault, (project) =>
      changeProjectDefault(project, projectDefault),
    );
  }

  async changeUseForEveryRole(id: string, useForEveryRole: boolean): Promise<Project> {
    return this.changeEngineLevels(id, null, (project) =>
      changeUseForEveryRole(project, useForEveryRole),
    );
  }

  /** Sets the Role's override in the Project, or removes it when `roleOverride` is null. */
  async changeRoleOverride(
    id: string,
    roleKey: string,
    roleOverride: EngineModel | null,
  ): Promise<Project> {
    return this.changeEngineLevels(id, roleOverride, (project) =>
      changeRoleOverride(project, roleKey, roleOverride),
    );
  }

  /**
   * Refuses, before saving, a change of the engine levels naming `named`, an engine and model
   * Settings › Engines must list, or that a registered check refuses. Held under Engine's
   * `EngineReferenceLock` from reading the engines through the save, so a removal can't come in
   * between; the events are published after. The check weighs the Project as read just before,
   * so another change to it made in between goes unchecked.
   */
  private async changeEngineLevels(
    id: string,
    named: EngineModel | null,
    change: (project: Project) => ProjectChange<DomainEvent> | undefined,
  ): Promise<Project> {
    const { project, events } = await this.engineReferences.holding(async () => {
      if (named !== null) await this.checks.checkEngineModel(named);
      const stored = await this.read(id);
      const changed = change(stored)?.project;
      if (changed) {
        const problems = await this.engineLevelsChecks.problemsOf({
          projectId: id,
          projectName: stored.name,
          before: engineLevelsOf(stored),
          after: engineLevelsOf(changed),
        });
        if (problems.length > 0) throw new ProjectRefused(problems);
      }
      return this.repository.update(id, (current) => asProjectChanges(current, change(current)));
    });
    await this.publish(events);
    return project;
  }

  /** Sessions already running keep the skills they started with. */
  async changeUseProjectSkills(id: string, useProjectSkills: boolean): Promise<Project> {
    return this.update(id, (project) => changeUseProjectSkills(project, useProjectSkills));
  }

  /** Sessions already running keep the skills they started with. */
  async changeProjectSkillUse(id: string, key: string, use: boolean): Promise<Project> {
    return this.update(id, (project) => changeProjectSkillUse(project, key, use));
  }

  private async update(
    id: string,
    change: (project: Project) => ProjectChange<DomainEvent> | undefined,
  ): Promise<Project> {
    return this.updateTogether(id, (project) => asProjectChanges(project, change(project)));
  }

  private async updateTogether(
    id: string,
    change: (project: Project) => ProjectChanges,
  ): Promise<Project> {
    const { project, events } = await this.repository.update(id, change);
    await this.publish(events);
    return project;
  }

  private async publish(events: readonly DomainEvent[]): Promise<void> {
    for (const event of events) await this.events.publish(event);
  }
}

function engineLevelsOf({
  projectDefault,
  useForEveryRole,
  roleOverrides,
}: ProjectEngineLevels): ProjectEngineLevels {
  return { projectDefault, useForEveryRole, roleOverrides };
}

function withResolvedPath(newProject: NewProject): NewProject {
  return { ...newProject, path: resolvedPath(newProject.path) };
}

/** The path as the repository's folder is named: without `..` or a trailing separator. */
function resolvedPath(path: string): string {
  return isAbsolute(path) ? resolve(path) : path;
}
