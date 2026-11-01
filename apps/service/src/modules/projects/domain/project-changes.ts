import type { DomainEvent } from "../../../platform/events/domain-event.js";
import {
  commandProblem,
  installInputsProblems,
  newProjectProblems,
  PROJECT_COMMAND_KEYS,
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
  ProjectUseProjectSkillsChanged,
} from "./project-events.js";
import {
  sameEnvironment,
  UNCHANGED_ENVIRONMENT,
  type ProjectEnvironment,
} from "./project-environment.js";
import { ProjectRefused } from "./project-refused.js";
import { proposedCommandsProblems, type ProjectCommandFields } from "./proposed-commands.js";

/** A Project after a change, with the event that announces it. */
export interface ProjectChange<Event extends DomainEvent> {
  readonly project: Project;
  readonly event: Event;
}

/** A Project after one or more changes kept together, with each change's event in order. */
export interface ProjectChanges {
  readonly project: Project;
  readonly events: readonly DomainEvent[];
}

/** One change, or none, as changes kept together. */
export function asProjectChanges(
  project: Project,
  change: ProjectChange<DomainEvent> | undefined,
): ProjectChanges {
  return change ? { project: change.project, events: [change.event] } : { project, events: [] };
}

/**
 * Applies a Proposal of commands and install inputs (spec §2.3) whole: refused with every reason
 * when one field changed since it was drafted or breaks a rule, else every field it changes, each
 * with its own event, as the Project page would save them one by one.
 */
export function changeCommandsAsProposed(
  project: Project,
  from: ProjectCommandFields,
  to: ProjectCommandFields,
): ProjectChanges {
  const problems = proposedCommandsProblems(project, from, to);
  if (problems.length > 0) throw new ProjectRefused(problems);
  const fieldChanges: ((current: Project) => ProjectChange<DomainEvent> | undefined)[] =
    PROJECT_COMMAND_KEYS.flatMap((key) => {
      const commandLine = to[key];
      return commandLine === undefined
        ? []
        : [(current: Project) => changeCommand(current, key, commandLine)];
    });
  const { installInputs } = to;
  if (installInputs) fieldChanges.push((current) => changeInstallInputs(current, installInputs));
  return fieldChanges.reduce<ProjectChanges>(
    (changes, fieldChange) => {
      const next = asProjectChanges(changes.project, fieldChange(changes.project));
      return { project: next.project, events: [...changes.events, ...next.events] };
    },
    { project, events: [] },
  );
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
    repositoryUrl: newProject.repositoryUrl ?? null,
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
export function changeUseProjectSkills(
  project: Project,
  useProjectSkills: boolean,
): ProjectChange<ProjectUseProjectSkillsChanged> | undefined {
  if (project.useProjectSkills === useProjectSkills) return undefined;
  return {
    project: { ...project, useProjectSkills },
    event: new ProjectUseProjectSkillsChanged(project.id, useProjectSkills),
  };
}
