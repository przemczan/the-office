import type { DomainEvent } from "../../../platform/events/domain-event.js";
import type { EngineModel } from "../../engine/index.js";
import {
  commandFieldsProblems,
  commandKeyProblems,
  commandOf,
  commandProblem,
  DEFAULT_PROJECT_LIMIT,
  INSTALL_COMMAND_KEY,
  installInputsProblems,
  markProblem,
  newProjectProblems,
  projectLimitProblem,
  publishingLineProblem,
  sameCommandFields,
  trimmedCommand,
  trimmedInstallInputs,
  trimmedMark,
  trimmedNewProject,
  type NewProject,
  type Project,
  type ProjectCommand,
  type ProjectCommandFields,
  type ProjectMark,
  type PublishingLine,
  type PublishingMode,
  type RunEnvironmentSetting,
} from "./project.js";
import {
  ProjectAdded,
  ProjectAfterPublishingCommandChanged,
  ProjectBeforePublishingCommandChanged,
  ProjectCommandAdded,
  ProjectCommandChanged,
  ProjectCommandRemoved,
  ProjectDefaultChanged,
  ProjectDefaultPipelineChanged,
  ProjectEnvironmentChanged,
  ProjectImageChanged,
  ProjectInstallCommandChanged,
  ProjectInstallInputsChanged,
  ProjectLimitChanged,
  ProjectMarkChanged,
  ProjectPublishingModeChanged,
  ProjectRoleOverrideChanged,
  ProjectRunEnvironmentChanged,
  ProjectSkillUseChanged,
  ProjectUseForEveryRoleChanged,
  ProjectUseProjectSkillsChanged,
} from "./project-events.js";
import {
  sameEnvironment,
  shownEnvironment,
  UNCHANGED_ENVIRONMENT,
  type ProjectEnvironment,
} from "./project-environment.js";
import {
  NO_PROJECT_IMAGE,
  type ProjectImage,
  type ProjectImageKey,
  type ProjectImagePalette,
} from "./project-image.js";
import { ProjectRefused } from "./project-refused.js";
import { proposedCommandsProblems, type ProposedCommands } from "./proposed-commands.js";

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
 * Applies a Proposal of commands (spec §2.3) whole: refused with every reason when one field
 * changed since it was drafted or breaks a rule, else every field it changes, each with its own
 * event, as the Project page would save them one by one.
 */
export function changeCommandsAsProposed(
  project: Project,
  proposed: ProposedCommands,
): ProjectChanges {
  const problems = proposedCommandsProblems(project, proposed);
  if (problems.length > 0) throw new ProjectRefused(problems);
  const { installCommand, installInputs, beforePublishingCommand, afterPublishingCommand } =
    proposed;
  return changesInTurn(project, [
    (current) => (installCommand ? changeInstallCommand(current, installCommand.to) : undefined),
    (current) => (installInputs ? changeInstallInputs(current, installInputs.to) : undefined),
    (current) =>
      beforePublishingCommand
        ? changePublishingLine(current, "beforePublishingCommand", beforePublishingCommand.to)
        : undefined,
    (current) =>
      afterPublishingCommand
        ? changePublishingLine(current, "afterPublishingCommand", afterPublishingCommand.to)
        : undefined,
    ...proposed.commands.map(({ key, from, to }) => (current: Project) => {
      if (to === null) return removeCommand(current, key);
      return from === null ? addCommand(current, { key, ...to }) : changeCommand(current, key, to);
    }),
  ]);
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
    icon: NO_PROJECT_IMAGE,
    logo: NO_PROJECT_IMAGE,
    beforePublishingCommand: "",
    afterPublishingCommand: "",
    environment: UNCHANGED_ENVIRONMENT,
    useProjectSkills: true,
    projectSkillsOff: [],
    projectDefault: null,
    useForEveryRole: false,
    roleOverrides: [],
    runEnvironment: "not-decided",
    runEnvironmentSetUpProblems: [],
    projectLimit: DEFAULT_PROJECT_LIMIT,
    addedAt,
  };
  return { project, event: new ProjectAdded(project) };
}

/** Once set, install can be changed but not cleared. Undefined when it is already that line. */
export function changeInstallCommand(
  project: Project,
  commandLine: string,
): ProjectChange<ProjectInstallCommandChanged> | undefined {
  const problem = commandProblem(INSTALL_COMMAND_KEY, commandLine);
  if (problem) throw new ProjectRefused([problem]);
  const installCommand = commandLine.trim();
  if (project.installCommand === installCommand) return undefined;
  return {
    project: { ...project, installCommand },
    event: new ProjectInstallCommandChanged(project.id, installCommand),
  };
}

/**
 * Sets Publish's before or after line, blank clearing it (spec §2.3 Defaults). Undefined when it is
 * already that line.
 */
export function changePublishingLine(
  project: Project,
  line: PublishingLine,
  commandLine: string,
):
  | ProjectChange<ProjectBeforePublishingCommandChanged | ProjectAfterPublishingCommandChanged>
  | undefined {
  const problem = publishingLineProblem(line, commandLine);
  if (problem) throw new ProjectRefused([problem]);
  const trimmed = commandLine.trim();
  if (project[line] === trimmed) return undefined;
  return {
    project: { ...project, [line]: trimmed },
    event:
      line === "beforePublishingCommand"
        ? new ProjectBeforePublishingCommandChanged(project.id, trimmed)
        : new ProjectAfterPublishingCommandChanged(project.id, trimmed),
  };
}

/** Adds the command after the Project's others, refused with every reason it breaks a rule. */
export function addCommand(
  project: Project,
  given: ProjectCommand,
): ProjectChange<ProjectCommandAdded> {
  const command = trimmedCommand(given);
  const problems = [
    ...commandKeyProblems(command.key, project.commands),
    ...commandFieldsProblems(command, { blankAllowed: false }),
  ];
  if (problems.length > 0) throw new ProjectRefused(problems);
  return {
    project: { ...project, commands: [...project.commands, command] },
    event: new ProjectCommandAdded(project.id, command),
  };
}

/**
 * The command's name, kind and command line; its key stays, as Pipelines name it by its key.
 * Undefined when it already has them.
 */
export function changeCommand(
  project: Project,
  key: string,
  given: ProjectCommandFields,
): ProjectChange<ProjectCommandChanged> | undefined {
  const current = existingCommand(project, key);
  const command: ProjectCommand = { key, ...trimmedCommand(given) };
  const problems = commandFieldsProblems(command, { blankAllowed: false });
  if (problems.length > 0) throw new ProjectRefused(problems);
  if (sameCommandFields(current, command)) return undefined;
  return {
    project: {
      ...project,
      commands: project.commands.map((each) => (each.key === key ? command : each)),
    },
    event: new ProjectCommandChanged(project.id, command),
  };
}

export function removeCommand(project: Project, key: string): ProjectChange<ProjectCommandRemoved> {
  existingCommand(project, key);
  return {
    project: { ...project, commands: project.commands.filter((each) => each.key !== key) },
    event: new ProjectCommandRemoved(project.id, key),
  };
}

function existingCommand(project: Project, key: string): ProjectCommand {
  const command = commandOf(project, key);
  if (!command) throw new ProjectRefused([`The Project has no command with the key "${key}".`]);
  return command;
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
    event: new ProjectEnvironmentChanged(project.id, shownEnvironment(environment)),
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
 * The user's On or Off. On is refused, with `definitionProblems` as the reasons, unless the base
 * branch holds a valid definition; Off always stands. Undefined when nothing would change.
 */
export function changeRunEnvironment(
  project: Project,
  runEnvironment: Exclude<RunEnvironmentSetting, "not-decided">,
  definitionProblems: readonly string[],
): ProjectChange<ProjectRunEnvironmentChanged> | undefined {
  if (runEnvironment === "on" && definitionProblems.length > 0) {
    throw new ProjectRefused([
      `Run environment can't be On: the base branch ${project.baseBranch} has no valid .devcontainer/.`,
      ...definitionProblems,
    ]);
  }
  return runEnvironmentChange(project, runEnvironment, []);
}

/**
 * A "Set up the run environment" Task is Done: On with a valid definition on its branch, else the
 * setting stays as it was and the definition's problems say why. Undefined when nothing would change.
 */
export function finishRunEnvironmentSetUp(
  project: Project,
  definitionProblems: readonly string[],
): ProjectChange<ProjectRunEnvironmentChanged> | undefined {
  return definitionProblems.length === 0
    ? runEnvironmentChange(project, "on", [])
    : runEnvironmentChange(project, project.runEnvironment, definitionProblems);
}

function runEnvironmentChange(
  project: Project,
  runEnvironment: RunEnvironmentSetting,
  setUpProblems: readonly string[],
): ProjectChange<ProjectRunEnvironmentChanged> | undefined {
  const unchanged =
    project.runEnvironment === runEnvironment &&
    setUpProblems.length === project.runEnvironmentSetUpProblems.length &&
    setUpProblems.every((problem, index) => problem === project.runEnvironmentSetUpProblems[index]);
  if (unchanged) return undefined;
  return {
    project: { ...project, runEnvironment, runEnvironmentSetUpProblems: setUpProblems },
    event: new ProjectRunEnvironmentChanged(project.id, runEnvironment, setUpProblems),
  };
}

/** Undefined when the Project already has that limit. */
export function changeProjectLimit(
  project: Project,
  projectLimit: number,
): ProjectChange<ProjectLimitChanged> | undefined {
  const problem = projectLimitProblem(projectLimit);
  if (problem) throw new ProjectRefused([problem]);
  if (project.projectLimit === projectLimit) return undefined;
  return {
    project: { ...project, projectLimit },
    event: new ProjectLimitChanged(project.id, projectLimit),
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

/** Undefined when the Project already holds that version, or has none to remove. */
export function changeImage(
  project: Project,
  key: ProjectImageKey,
  palette: ProjectImagePalette,
  image: ProjectImage | null,
): ProjectChange<ProjectImageChanged> | undefined {
  if (project[key][palette]?.id === image?.id) return undefined;
  return {
    project: { ...project, [key]: { ...project[key], [palette]: image } },
    event: new ProjectImageChanged(project.id, key, palette, image),
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
