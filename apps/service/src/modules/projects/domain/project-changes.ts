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
  ProjectInstallInputsChanged,
  ProjectPublishingModeChanged,
} from "./project-events.js";
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
  const project: Project = { id, ...newProject, useProjectSkills: true, addedAt };
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
