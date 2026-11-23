import type { DomainEvent } from "../../../platform/events/domain-event.js";
import type { EngineRemoval } from "../../engine/index.js";
import {
  DEFAULT_ISSUE_SETTINGS,
  type IssueSettings,
  type IssueSettingsChange,
  type IssueUser,
} from "./issue-settings.js";
import { NO_KIND_DEFAULT_PIPELINES, type TaskKind } from "./kind-default-pipeline.js";
import {
  commandFieldsProblems,
  commandKeyProblems,
  commandOf,
  commandProblem,
  DEFAULT_PROJECT_LIMIT,
  INSTALL_COMMAND_KEY,
  installInputsProblems,
  NO_PROJECT_ENGINE,
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
  type ProjectEngine,
  type ProjectEnginePerson,
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
  ProjectDefaultPipelineChanged,
  ProjectFeaturesChanged,
  ProjectIssueSettingsChanged,
  ProjectKindDefaultPipelineChanged,
  ProjectEnvironmentChanged,
  ProjectImageChanged,
  ProjectInstallCommandChanged,
  ProjectInstallInputsChanged,
  ProjectLimitChanged,
  ProjectMarkChanged,
  ProjectPublishingModeChanged,
  ProjectDeleteMergedBranchesChanged,
  ProjectEngineChanged,
  ProjectRunEnvironmentChanged,
  ProjectSkillUseChanged,
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
import {
  changedFeatureSwitches,
  featureStatesOf,
  sameFeatureSwitches,
  type ProjectFeatureSwitches,
} from "./project-features.js";
import {
  engineTypeOffersOf,
  forceOfferedBy,
  sameProjectEngine,
  type EngineTypeOffers,
  type ProjectEngineChange,
} from "./project-engine.js";
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
 * Moves the Project default naming the engine being removed to the replacement, which gives it its
 * type (spec §5.4.5, "Removing an engine"); a forced model or effort a new type doesn't offer goes
 * back to "Engine's default". Moved to none, with the only engine, the default and the force clear.
 * People's settings name engine types, so they stay. None when the default names another engine.
 */
export function moveEngineLevels(project: Project, removal: EngineRemoval): ProjectChanges {
  const { default: projectDefault, force } = project.engine;
  if (projectDefault?.engineId !== removal.engineId) return asProjectChanges(project, undefined);
  const { replacement } = removal;
  const engine: ProjectEngine =
    replacement === null
      ? { ...project.engine, default: null, force: null }
      : {
          ...project.engine,
          default: { engineType: replacement.kind, engineId: replacement.id },
          force:
            force && replacement.kind !== projectDefault.engineType
              ? forceOfferedBy(force, replacement.kind, engineTypeOffersOf([replacement]))
              : force,
        };
  return asProjectChanges(project, engineChange(project, engine));
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
    deleteMergedBranches: false,
    environment: UNCHANGED_ENVIRONMENT,
    useProjectSkills: true,
    projectSkillsOff: [],
    engine: NO_PROJECT_ENGINE,
    runEnvironment: "not-decided",
    runEnvironmentSetUpProblems: [],
    projectLimit: DEFAULT_PROJECT_LIMIT,
    addedAt,
    kindDefaultPipelines: NO_KIND_DEFAULT_PIPELINES,
    issueSettings: DEFAULT_ISSUE_SETTINGS,
    features: newProject.features ?? {},
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
 * The command's name, kind, command line and re-run command; its key stays, as Pipelines name it
 * by its key. Undefined when it already has them.
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
 * Undefined when the Project already has that environment. That it follows the rules is for the
 * caller to know.
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

/** Undefined when the setting is already so. */
export function changeDeleteMergedBranches(
  project: Project,
  on: boolean,
): ProjectChange<ProjectDeleteMergedBranchesChanged> | undefined {
  if (project.deleteMergedBranches === on) return undefined;
  return {
    project: { ...project, deleteMergedBranches: on },
    event: new ProjectDeleteMergedBranchesChanged(project.id, on),
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
 * A Kind's own default Pipeline; null follows the Project's default Pipeline. Undefined when it is
 * already so. That the Pipeline can run in the Project is checked by the caller.
 */
export function changeKindDefaultPipeline(
  project: Project,
  kind: TaskKind,
  pipelineId: string | null,
): ProjectChange<ProjectKindDefaultPipelineChanged> | undefined {
  if (project.kindDefaultPipelines[kind] === pipelineId) return undefined;
  return {
    project: {
      ...project,
      kindDefaultPipelines: { ...project.kindDefaultPipelines, [kind]: pipelineId },
    },
    event: new ProjectKindDefaultPipelineChanged(project.id, kind, pipelineId),
  };
}

/**
 * The Project's GitHub issue switches. A label set or changed records `by` as who set it, whom the
 * auto-import names as the creator of its Tasks; no label forgets them. Undefined when nothing
 * changed.
 */
export function changeIssueSettings(
  project: Project,
  { autoImportLabel, closeOnDone, commentOnStartAndDone, closeOnDrop }: IssueSettingsChange,
  by: IssueUser,
): ProjectChange<ProjectIssueSettingsChanged> | undefined {
  const before = project.issueSettings;
  const label = autoImportLabel?.trim() || null;
  const autoImportLabelSetBy =
    label === null ? null : label === before.autoImportLabel ? before.autoImportLabelSetBy : by;
  const issueSettings: IssueSettings = {
    autoImportLabel: label,
    autoImportLabelSetBy,
    closeOnDone,
    commentOnStartAndDone,
    closeOnDrop,
  };
  if (
    before.autoImportLabel === label &&
    before.closeOnDone === closeOnDone &&
    before.commentOnStartAndDone === commentOnStartAndDone &&
    before.closeOnDrop === closeOnDrop
  ) {
    return undefined;
  }
  return {
    project: { ...project, issueSettings },
    event: new ProjectIssueSettingsChanged(project.id, issueSettings),
  };
}

/**
 * The Project's feature switches after `changes` (project-features.ts' rules), announced with every
 * feature as it reads after. Undefined when no switch changed.
 */
export function changeFeatures(
  project: Project,
  changes: ProjectFeatureSwitches,
): ProjectChange<ProjectFeaturesChanged> | undefined {
  const features = changedFeatureSwitches(project, project.name, changes);
  if (sameFeatureSwitches(features, project.features)) return undefined;
  const changed = { ...project, features };
  return {
    project: changed,
    event: new ProjectFeaturesChanged(project.id, featureStatesOf(changed)),
  };
}

/**
 * Saves the Project page's Engine block (spec §5.4.5, "The API"): each level sent replaces the
 * Project's, each left out stays. Refused for a force without a default engine type and for a
 * person named twice or by no Role key; a person with nothing set on any type isn't kept. Clearing
 * the default clears the force; a default changed to another type keeps the force on with what the
 * new type doesn't offer, among `offers`, back to "Engine's default". That the engines are listed
 * and offer what is set is checked by the caller (`projectEngineProblems`); that a Role is filled
 * under a person's key is not, since People reads these levels and not the other way round.
 * Undefined when nothing changes.
 */
export function changeProjectEngine(
  project: Project,
  change: ProjectEngineChange,
  offers: EngineTypeOffers,
): ProjectChange<ProjectEngineChanged> | undefined {
  const stored = project.engine;
  const projectDefault = change.default === undefined ? stored.default : change.default;
  let force = change.force === undefined ? stored.force : change.force;
  if (projectDefault === null) {
    if (change.force !== undefined && change.force !== null) {
      throw new ProjectRefused(["Pick an engine type first."]);
    }
    force = null;
  } else if (
    change.force === undefined &&
    force !== null &&
    projectDefault.engineType !== stored.default?.engineType
  ) {
    force = forceOfferedBy(force, projectDefault.engineType, offers);
  }
  const people = change.people === undefined ? stored.people : keptPeople(change.people);
  return engineChange(project, { default: projectDefault, force, people });
}

/** The people sent, without those that set nothing; refused for a person named twice or by none. */
function keptPeople(people: readonly ProjectEnginePerson[]): readonly ProjectEnginePerson[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const { roleKey } of people) {
    if (roleKey.trim() === "") {
      problems.push("Each person's setting names its person.");
    } else if (seen.has(roleKey)) {
      problems.push(`"${roleKey}" is named twice.`);
    }
    seen.add(roleKey);
  }
  if (problems.length > 0) throw new ProjectRefused([...new Set(problems)]);
  return people.filter(({ engineSettings }) =>
    Object.values(engineSettings).some(
      (setting) => setting.model !== null || setting.effort !== null,
    ),
  );
}

function engineChange(
  project: Project,
  engine: ProjectEngine,
): ProjectChange<ProjectEngineChanged> | undefined {
  if (sameProjectEngine(project.engine, engine)) return undefined;
  return { project: { ...project, engine }, event: new ProjectEngineChanged(project.id, engine) };
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
