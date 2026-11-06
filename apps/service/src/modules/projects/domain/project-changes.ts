import type { DomainEvent } from "../../../platform/events/domain-event.js";
import type { EngineModel } from "../../engine/index.js";
import {
  commandProblem,
  installInputsProblems,
  markProblem,
  newProjectProblems,
  PROJECT_COMMAND_KEYS,
  trimmedInstallInputs,
  trimmedMark,
  trimmedNewProject,
  type NewProject,
  type Project,
  type ProjectCommandKey,
  type ProjectMark,
  type PublishingMode,
} from "./project.js";
import {
  ProjectAdded,
  ProjectCommandChanged,
  ProjectDefaultChanged,
  ProjectDefaultPipelineChanged,
  ProjectEnvironmentChanged,
  ProjectInstallInputsChanged,
  ProjectMarkChanged,
  ProjectPublishingModeChanged,
  ProjectRoleOverrideChanged,
  ProjectSkillUseChanged,
  ProjectUseForEveryRoleChanged,
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
  return changesInTurn(project, fieldChanges);
}

/**
 * Moves the Project default and each Role override where `move` puts them, as the user removing
 * an engine moves them (spec §5.4), each with its own event; none when nothing names the engine.
 * Moved to none, with the only engine, the Project default takes "Use for every Role" with it.
 */
export function moveEngineLevels(
  project: Project,
  move: (reference: EngineModel) => EngineModel | null,
): ProjectChanges {
  const { projectDefault } = project;
  const movedDefault = projectDefault && move(projectDefault);
  return changesInTurn(project, [
    // A Project default moved to none takes "Use for every Role" with it.
    (current) =>
      projectDefault && movedDefault === null ? changeUseForEveryRole(current, false) : undefined,
    (current) => (projectDefault ? changeProjectDefault(current, movedDefault) : undefined),
    ...project.roleOverrides.map(
      ({ roleKey, engineId, model }) =>
        (current: Project) =>
          changeRoleOverride(current, roleKey, move({ engineId, model })),
    ),
  ]);
}

/** Each change applied to the Project the one before left, kept together. */
function changesInTurn(
  project: Project,
  fieldChanges: readonly ((current: Project) => ProjectChange<DomainEvent> | undefined)[],
): ProjectChanges {
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
    projectSkillsOff: [],
    projectDefault: null,
    useForEveryRole: false,
    roleOverrides: [],
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

/** Undefined when the Project already has that label and colour. */
export function changeMark(
  project: Project,
  given: ProjectMark,
): ProjectChange<ProjectMarkChanged> | undefined {
  const mark = trimmedMark(given);
  const problem = markProblem(mark);
  if (problem) throw new ProjectRefused([problem]);
  if (project.mark.label === mark.label && project.mark.colour === mark.colour) return undefined;
  return { project: { ...project, mark }, event: new ProjectMarkChanged(project.id, mark) };
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

/**
 * Undefined when it is already the Project default. That the engine is listed and offers the model
 * is checked by the caller, which can ask the Engine module.
 */
export function changeProjectDefault(
  project: Project,
  projectDefault: EngineModel | null,
): ProjectChange<ProjectDefaultChanged> | undefined {
  if (sameEngineModel(project.projectDefault, projectDefault)) return undefined;
  if (projectDefault === null && project.useForEveryRole) {
    throw new ProjectRefused([
      'Turn off "Use for every Role" before leaving the Project without a default.',
    ]);
  }
  return {
    project: { ...project, projectDefault },
    event: new ProjectDefaultChanged(project.id, projectDefault),
  };
}

/** Undefined when the Project default already is, or isn't, used for every Role. */
export function changeUseForEveryRole(
  project: Project,
  useForEveryRole: boolean,
): ProjectChange<ProjectUseForEveryRoleChanged> | undefined {
  if (project.useForEveryRole === useForEveryRole) return undefined;
  if (useForEveryRole && project.projectDefault === null) {
    throw new ProjectRefused(["Choose a Project default before using it for every Role."]);
  }
  return {
    project: { ...project, useForEveryRole },
    event: new ProjectUseForEveryRoleChanged(project.id, useForEveryRole),
  };
}

/**
 * Sets the Role's override in the Project, or removes it when `roleOverride` is null; undefined
 * when that is already so. That the engine offers the model is checked by the caller; that a Role
 * is filled under `roleKey` is not, since People reads these levels and not the other way round.
 */
export function changeRoleOverride(
  project: Project,
  roleKey: string,
  roleOverride: EngineModel | null,
): ProjectChange<ProjectRoleOverrideChanged> | undefined {
  if (roleKey.trim() === "") throw new ProjectRefused(["A Role override names its Role."]);
  const current = project.roleOverrides.find((override) => override.roleKey === roleKey) ?? null;
  if (sameEngineModel(current, roleOverride)) return undefined;
  const others = project.roleOverrides.filter((override) => override.roleKey !== roleKey);
  const roleOverrides =
    roleOverride === null
      ? others
      : current === null
        ? [...others, { roleKey, ...roleOverride }]
        : project.roleOverrides.map((override) =>
            override.roleKey === roleKey ? { roleKey, ...roleOverride } : override,
          );
  return {
    project: { ...project, roleOverrides },
    event: new ProjectRoleOverrideChanged(project.id, roleKey, roleOverride),
  };
}

function sameEngineModel(first: EngineModel | null, second: EngineModel | null): boolean {
  if (first === null || second === null) return first === second;
  return first.engineId === second.engineId && first.model === second.model;
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

/** Undefined when the repository's skill of this key is already on, or off. */
export function changeProjectSkillUse(
  project: Project,
  key: string,
  use: boolean,
): ProjectChange<ProjectSkillUseChanged> | undefined {
  if (project.projectSkillsOff.includes(key) !== use) return undefined;
  const projectSkillsOff = use
    ? project.projectSkillsOff.filter((offKey) => offKey !== key)
    : [...project.projectSkillsOff, key];
  return {
    project: { ...project, projectSkillsOff },
    event: new ProjectSkillUseChanged(project.id, key, use),
  };
}
