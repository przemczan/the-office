import type { DomainEvent } from "../../../platform/events/domain-event.js";
import {
  commandProblem,
  installInputsProblems,
  newProjectProblems,
  trimmedInstallInputs,
  trimmedNewProject,
  type NewProject,
  type Project,
  type ProjectCommandKey,
  type PublishingMode,
} from "./project.js";
import {
  ProjectAdded,
  ProjectCommandChanged,
  ProjectDefaultPipelineChanged,
  ProjectEnvironmentChanged,
  ProjectInstallInputsChanged,
  ProjectPublishingModeChanged,
  ProjectUseOfSkillsChanged,
} from "./project-events.js";
import {
  sameEnvironment,
  UNCHANGED_ENVIRONMENT,
  type ProjectEnvironment,
} from "./project-environment.js";
import { ProjectRefused } from "./project-refused.js";

/** A Project after a change, with the event that announces it. */
export interface ProjectChange<Event extends DomainEvent> {
  readonly project: Project;
  readonly event: Event;
}

/** Refuses with every reason when the new Project's own fields break a rule. */
export function addProject(
  id: string,
  given: NewProject,
  addedAt: Date,
): ProjectChange<ProjectAdded> {
  const newProject = trimmedNewProject(given);
  const problems = newProjectProblems(newProject);
  if (problems.length > 0) throw new ProjectRefused(problems);
  const project: Project = {
    id,
    ...newProject,
    environment: UNCHANGED_ENVIRONMENT,
    useProjectSkills: true,
    addedAt,
  };
  return { project, event: new ProjectAdded(project) };
}

/** Undefined when the command is already that line. */
export function changeCommand(
  project: Project,
  key: ProjectCommandKey,
  commandLine: string,
): ProjectChange<ProjectCommandChanged> | undefined {
  const problem = commandProblem(key, commandLine);
  if (problem) throw new ProjectRefused([problem]);
  const trimmed = commandLine.trim();
  if (project.commands[key] === trimmed) return undefined;
  return {
    project: { ...project, commands: { ...project.commands, [key]: trimmed } },
    event: new ProjectCommandChanged(project.id, key, trimmed),
  };
}

/** Undefined when the Project already has those install inputs, in that order. */
export function changeInstallInputs(
  project: Project,
  given: readonly string[],
): ProjectChange<ProjectInstallInputsChanged> | undefined {
  const problems = installInputsProblems(given);
  if (problems.length > 0) throw new ProjectRefused(problems);
  const installInputs = trimmedInstallInputs(given);
  const unchanged =
    installInputs.length === project.installInputs.length &&
    installInputs.every((input, index) => input === project.installInputs[index]);
  if (unchanged) return undefined;
  return {
    project: { ...project, installInputs },
    event: new ProjectInstallInputsChanged(project.id, installInputs),
  };
}

/**
 * Undefined when the Project already has that environment. That it passed the environment check,
 * and follows the rules, is for the caller to know.
 */
export function changeEnvironment(
  project: Project,
  environment: ProjectEnvironment,
): ProjectChange<ProjectEnvironmentChanged> | undefined {
  if (sameEnvironment(project.environment, environment)) return undefined;
  return {
    project: { ...project, environment },
    event: new ProjectEnvironmentChanged(project.id, environment),
  };
}

/** Undefined when the Project already publishes that way. */
export function changePublishingMode(
  project: Project,
  publishingMode: PublishingMode,
): ProjectChange<ProjectPublishingModeChanged> | undefined {
  if (project.publishingMode === publishingMode) return undefined;
  return {
    project: { ...project, publishingMode },
    event: new ProjectPublishingModeChanged(project.id, publishingMode),
  };
}

/**
 * Undefined when it is already the default. That the Pipeline exists is checked by the caller,
 * which can ask the Pipelines.
 */
export function changeDefaultPipeline(
  project: Project,
  defaultPipeline: string,
): ProjectChange<ProjectDefaultPipelineChanged> | undefined {
  if (project.defaultPipeline === defaultPipeline) return undefined;
  return {
    project: { ...project, defaultPipeline },
    event: new ProjectDefaultPipelineChanged(project.id, defaultPipeline),
  };
}

/** Undefined when the Project already does, or doesn't, use its own skills. */
export function changeUseOfSkills(
  project: Project,
  useProjectSkills: boolean,
): ProjectChange<ProjectUseOfSkillsChanged> | undefined {
  if (project.useProjectSkills === useProjectSkills) return undefined;
  return {
    project: { ...project, useProjectSkills },
    event: new ProjectUseOfSkillsChanged(project.id, useProjectSkills),
  };
}
