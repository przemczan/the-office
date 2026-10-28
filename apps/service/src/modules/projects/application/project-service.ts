import { isAbsolute, resolve } from "node:path";
import { Injectable } from "@nestjs/common";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  PROJECT_COMMAND_KEYS,
  projectIdFor,
  trimmedNewProject,
  type NewProject,
  type Project,
  type ProjectCommandKey,
  type PublishingMode,
} from "../domain/project.js";
import {
  addProject,
  changeCommand,
  changeDefaultPipeline,
  changeEnvironment,
  changeInstallInputs,
  changePublishingMode,
  changeUseProjectSkills,
  type ProjectChange,
} from "../domain/project-changes.js";
import { ProjectNotFound } from "../domain/project-not-found.js";
import type { ProjectEnvironment } from "../domain/project-environment.js";
import { ProjectRefused } from "../domain/project-refused.js";
import {
  proposedCommandsProblems,
  type ProjectCommandFields,
} from "../domain/proposed-commands.js";
import { ProjectRepository } from "../ports/project-repository.js";
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
    private readonly events: EventBus,
  ) {}

  /** Refuses with every reason, before saving, when the Project breaks a rule. */
  async add(given: NewProject): Promise<Project> {
    const newProject = withResolvedPath(trimmedNewProject(given));
    await this.checks.checkNewProject(newProject);
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

  /** Tasks already running keep the command line they started with. */
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
   * Applies a Proposal of commands and install inputs (spec §2.3), refused with every reason, and
   * changing nothing, when one field changed since it was drafted or breaks a rule. Each field is
   * saved with its own event, as the Project page saves it, and checked again as its row is held.
   */
  async changeCommandsAsProposed(
    id: string,
    from: ProjectCommandFields,
    to: ProjectCommandFields,
  ): Promise<Project> {
    refuseProblems(proposedCommandsProblems(await this.read(id), from, to));
    for (const key of PROJECT_COMMAND_KEYS) {
      const commandLine = to[key];
      if (commandLine === undefined) continue;
      await this.update(id, (project) => {
        refuseProblems(proposedCommandsProblems(project, from, { [key]: commandLine }));
        return changeCommand(project, key, commandLine);
      });
    }
    const { installInputs } = to;
    if (installInputs) {
      await this.update(id, (project) => {
        refuseProblems(proposedCommandsProblems(project, from, { installInputs }));
        return changeInstallInputs(project, installInputs);
      });
    }
    return this.read(id);
  }

  /** For the environment check, once it passed with the environment. */
  async changeEnvironment(id: string, environment: ProjectEnvironment): Promise<Project> {
    return this.update(id, (project) => changeEnvironment(project, environment));
  }

  async changePublishingMode(id: string, publishingMode: PublishingMode): Promise<Project> {
    return this.update(id, (project) => changePublishingMode(project, publishingMode));
  }

  async changeDefaultPipeline(id: string, defaultPipeline: string): Promise<Project> {
    await this.checks.checkDefaultPipeline(defaultPipeline);
    return this.update(id, (project) => changeDefaultPipeline(project, defaultPipeline));
  }

  /** Sessions already running keep the skills they started with. */
  async changeUseProjectSkills(id: string, useProjectSkills: boolean): Promise<Project> {
    return this.update(id, (project) => changeUseProjectSkills(project, useProjectSkills));
  }

  private async update<Event extends DomainEvent>(
    id: string,
    change: (project: Project) => ProjectChange<Event> | undefined,
  ): Promise<Project> {
    const { project, event } = await this.repository.update(id, change);
    if (event) await this.events.publish(event);
    return project;
  }
}

function refuseProblems(problems: readonly string[]): void {
  if (problems.length > 0) throw new ProjectRefused(problems);
}

/** The path as the repository's folder is named: without `..` or a trailing separator. */
function withResolvedPath(newProject: NewProject): NewProject {
  return isAbsolute(newProject.path)
    ? { ...newProject, path: resolve(newProject.path) }
    : newProject;
}
