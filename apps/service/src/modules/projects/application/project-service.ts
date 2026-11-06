import { isAbsolute, resolve } from "node:path";
import { Injectable } from "@nestjs/common";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EngineReferenceLock, type EngineModel } from "../../engine/index.js";
import {
  projectIdFor,
  trimmedNewProject,
  type NewProject,
  type Project,
  type ProjectCommandKey,
  type ProjectEngineLevels,
  type ProjectMark,
  type PublishingMode,
} from "../domain/project.js";
import {
  addProject,
  asProjectChanges,
  changeCommand,
  changeCommandsAsProposed,
  changeDefaultPipeline,
  changeEnvironment,
  changeInstallInputs,
  changeMark,
  changeProjectDefault,
  changePublishingMode,
  changeRoleOverride,
  changeUseForEveryRole,
  changeProjectSkillUse,
  changeUseProjectSkills,
  type ProjectChange,
  type ProjectChanges,
} from "../domain/project-changes.js";
import { ProjectNotFound } from "../domain/project-not-found.js";
import { ProjectRefused } from "../domain/project-refused.js";
import type { ProjectEnvironment } from "../domain/project-environment.js";
import {
  proposedCommandsProblems,
  type ProjectCommandFields,
} from "../domain/proposed-commands.js";
import { CLONE_REMOTE, Git } from "../ports/git.js";
import { ProjectRepository } from "../ports/project-repository.js";
import { EngineLevelsChecks } from "./engine-levels-checks.js";
import { ProjectChecks } from "./project-checks.js";

/**
 * The Projects use cases. Each change is saved first and its event published after, so nothing
 * hears of a change that wasn't kept.
 */
@Injectable()
export class ProjectService {
  constructor(
    private readonly repository: ProjectRepository,
    private readonly checks: ProjectChecks,
    private readonly git: Git,
    private readonly events: EventBus,
    private readonly engineLevelsChecks: EngineLevelsChecks,
    private readonly engineReferences: EngineReferenceLock,
  ) {}

  /** Refuses with every reason, before saving, when the Project breaks a rule. */
  async add(given: NewProject): Promise<Project> {
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

  /** Undefined when there is no such Project. */
  async find(id: string): Promise<Project | undefined> {
    return this.repository.find(id);
  }

  /** The Project added from the repository at `path`, read as `add` reads it; undefined when none. */
  async findByPath(path: string): Promise<Project | undefined> {
    const repositoryPath = resolvedPath(path.trim());
    return (await this.repository.list()).find((project) => project.path === repositoryPath);
  }

  /** A running Task runs the new line from its next Script Stage, which reads it when it runs. */
  async changeCommand(id: string, key: ProjectCommandKey, commandLine: string): Promise<Project> {
    return this.update(id, (project) => changeCommand(project, key, commandLine));
  }

  async changeInstallInputs(id: string, installInputs: readonly string[]): Promise<Project> {
    return this.update(id, (project) => changeInstallInputs(project, installInputs));
  }

  /**
   * Every reason a Proposal of commands and install inputs can't apply to the Project now
   * (`proposedCommandsProblems`), or that there is no such Project.
   */
  async proposedCommandsProblems(
    id: string,
    from: ProjectCommandFields,
    to: ProjectCommandFields,
  ): Promise<string[]> {
    const project = await this.find(id);
    return project
      ? proposedCommandsProblems(project, from, to)
      : [new ProjectNotFound(id).message];
  }

  /**
   * Applies a Proposal of commands and install inputs (spec §2.3) all or nothing: checked against
   * the Project as its row is held and saved in one go, so a hand edit can't land between fields.
   */
  async changeCommandsAsProposed(
    id: string,
    from: ProjectCommandFields,
    to: ProjectCommandFields,
  ): Promise<Project> {
    return this.updateTogether(id, (project) => changeCommandsAsProposed(project, from, to));
  }

  /** For the environment check, once it passed with the environment. */
  async changeEnvironment(id: string, environment: ProjectEnvironment): Promise<Project> {
    return this.update(id, (project) => changeEnvironment(project, environment));
  }

  async changePublishingMode(id: string, publishingMode: PublishingMode): Promise<Project> {
    return this.update(id, (project) => changePublishingMode(project, publishingMode));
  }

  async changeMark(id: string, mark: ProjectMark): Promise<Project> {
    return this.update(id, (project) => changeMark(project, mark));
  }

  async changeDefaultPipeline(id: string, defaultPipeline: string): Promise<Project> {
    await this.checks.checkDefaultPipeline(defaultPipeline);
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
