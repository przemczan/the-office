import type { EngineModel } from "../../engine/index.js";
import type { IssueSettings } from "./issue-settings.js";
import type { KindDefaultPipelines } from "./kind-default-pipeline.js";
import type { ProjectEnvironment } from "./project-environment.js";
import type { ProjectImageVersions } from "./project-image.js";

/** What a Project command does; a test command also gets the test handling (spec §5.5). */
export const PROJECT_COMMAND_KINDS = ["build", "lint", "test"] as const;
export type ProjectCommandKind = (typeof PROJECT_COMMAND_KINDS)[number];

/** A command's own fields, all of it but the key, which is fixed once the command is added. */
export interface ProjectCommandFields {
  readonly name: string;
  readonly kind: ProjectCommandKind;
  /** A command line for the platform's shell; blank only for a starting command not set yet. */
  readonly commandLine: string;
  /**
   * A test command's re-run command: run once in its place when it fails, to tell a flake (spec
   * §5.5); blank for none, and always blank on a command not of kind test.
   */
  readonly rerunCommandLine: string;
}

/** One of the Project's commands besides install, run by its key (spec §2.1). */
export interface ProjectCommand extends ProjectCommandFields {
  readonly key: string;
}

/** Install's key, which Agents run it by; no other command may take it. */
export const INSTALL_COMMAND_KEY = "install";

/** Keys a command can't take: install's, and Publish's, which isn't a Project command. */
const RESERVED_COMMAND_KEYS: readonly string[] = [INSTALL_COMMAND_KEY, "publish"];

/** The commands every Project starts with, their command lines given when it is added. */
export const STARTING_COMMANDS: readonly Omit<
  ProjectCommand,
  "commandLine" | "rerunCommandLine"
>[] = [
  { key: "build", name: "Build", kind: "build" },
  { key: "lint", name: "Lint", kind: "lint" },
  { key: "test", name: "Test", kind: "test" },
];

/** How Publish ships a Task's branch, run by The Office's own git code (spec §9). */
export const PUBLISHING_MODES = ["push-and-pull-request", "merge"] as const;
export type PublishingMode = (typeof PUBLISHING_MODES)[number];

/**
 * Publish's before and after lines (spec §2.3 Defaults): the Project's own steps around The
 * Office's push, pull request or merge. They aren't Project commands: no key, and blank runs nothing.
 */
export const PUBLISHING_LINES = ["beforePublishingCommand", "afterPublishingCommand"] as const;
export type PublishingLine = (typeof PUBLISHING_LINES)[number];

/** Each line as its problems name it. */
export const PUBLISHING_LINE_NAMES: Readonly<Record<PublishingLine, string>> = {
  beforePublishingCommand: "before publishing",
  afterPublishingCommand: "after publishing",
};

/**
 * Whether the Project's checks run in its run environment: "not-decided" until the user picks On
 * or Off, and run on the host meanwhile, as with Off.
 */
export const RUN_ENVIRONMENT_SETTINGS = ["not-decided", "on", "off"] as const;
export type RunEnvironmentSetting = (typeof RUN_ENVIRONMENT_SETTINGS)[number];

/**
 * The answer to the question asked once while the setting is "not-decided": "yes" acts as Set up
 * run environment, "no" sets Off, "decide-later" leaves it.
 */
export type RunEnvironmentAnswer = "yes" | "no" | "decide-later";

/** The design system's ramps offered as a mark's quick choices. */
export const NAMED_MARK_COLOURS = ["teal", "violet", "gray", "ink"] as const;

/** One of the named colours, or any other as `#rrggbb` in lower case (spec §4). */
export type ProjectMarkColour = (typeof NAMED_MARK_COLOURS)[number] | `#${string}`;

/** A short label on a colour, shown wherever an item names its Project. */
export interface ProjectMark {
  readonly label: string;
  readonly colour: ProjectMarkColour;
}

/** A repository The Office works on, with its own commands and settings. */
export interface Project {
  /** Taken from the name when the Project is added, and kept. */
  readonly id: string;
  readonly name: string;
  /** The repository's top-level folder on the workstation. */
  readonly path: string;
  /** What the repository was cloned from into `path`; null for a Project added by its path. */
  readonly repositoryUrl: string | null;
  /** What every Task branches from and publishes to. */
  readonly baseBranch: string;
  readonly mark: ProjectMark;
  /** Shown in place of the mark's label and colour, in the version for the palette shown. */
  readonly icon: ProjectImageVersions;
  /** The larger image on the Project's page and card, in the version for the palette shown. */
  readonly logo: ProjectImageVersions;
  /** Run before a Stage when the install inputs changed (spec §9); blank while not set. */
  readonly installCommand: string;
  /** In the order they were added; keys are unique. */
  readonly commands: readonly ProjectCommand[];
  /**
   * The files whose change makes a worktree install again, as paths inside the repository with
   * `/` between folders (spec §9).
   */
  readonly installInputs: readonly string[];
  readonly publishingMode: PublishingMode;
  /** Run in the Task's worktree before Publish ships anything; blank runs nothing. */
  readonly beforePublishingCommand: string;
  /** Run in the Task's worktree once Publish opened a pull request or merged; blank runs nothing. */
  readonly afterPublishingCommand: string;
  /**
   * Delete branches once merged (spec §5.5, "Deleting merged branches"): a merged Task's branch and
   * a Done, published Initiative's are deleted here and on the remote. Off by default.
   */
  readonly deleteMergedBranches: boolean;
  /** The id of the Pipeline a new Task starts from. */
  readonly defaultPipeline: string;
  readonly environment: ProjectEnvironment;
  /** Whether sessions in this Project also get the repository's own skills (spec §2.6). */
  readonly useProjectSkills: boolean;
  /**
   * The keys of the repository's skills and commands the Project turned off, each by itself. Any
   * other is on, so one added later starts on (spec §2.6).
   */
  readonly projectSkillsOff: readonly string[];
  /** The engine cascade's Project levels (spec §5.4), set in the Project page's Engine block. */
  readonly projectDefault: EngineModel | null;
  /** Whether the Project default wins over the Office-wide Role overrides; set only with one. */
  readonly useForEveryRole: boolean;
  /** At most one per Role, winning over every other level in this Project. */
  readonly roleOverrides: readonly ProjectRoleOverride[];
  readonly runEnvironment: RunEnvironmentSetting;
  /**
   * Why the last "Set up the run environment" Task's Done left the setting as it was: each problem
   * of the definition on its branch; empty when it turned On or none has been Done.
   */
  readonly runEnvironmentSetUpProblems: readonly string[];
  /** How many of the Project's Tasks may be started at once (spec §2.1), 1 to `PROJECT_LIMIT_MAX`. */
  readonly projectLimit: number;
  readonly addedAt: Date;
  /** Each Kind's own default Pipeline; null follows `defaultPipeline` (kind-default-pipeline.ts). */
  readonly kindDefaultPipelines: KindDefaultPipelines;
  /** Its GitHub issue switches. */
  readonly issueSettings: IssueSettings;
}

/** Every Project starts with one Task at a time; the user raises it on the Project page. */
export const DEFAULT_PROJECT_LIMIT = 1;

/** The Office-wide limit's maximum, as more could never be started at once. */
export const PROJECT_LIMIT_MAX = 12;

/** The Project's levels of the engine cascade, which People resolves. */
export type ProjectEngineLevels = Pick<
  Project,
  "projectDefault" | "useForEveryRole" | "roleOverrides"
>;

/** The engine and model the Role `roleKey` runs on in a Project. */
export interface ProjectRoleOverride extends EngineModel {
  readonly roleKey: string;
}

/** What the user gives when adding a Project; the rest is set by The Office. */
export type NewProject = Pick<
  Project,
  | "name"
  | "path"
  | "baseBranch"
  | "mark"
  | "installCommand"
  | "commands"
  | "installInputs"
  | "publishingMode"
  | "defaultPipeline"
> & {
  /** Given only for a clone, whose folder `path` then is. */
  readonly repositoryUrl?: string | undefined;
};

const NAME_LENGTH = 60;
const COMMAND_KEY = /^[a-z][a-z0-9-]*$/;
const COMMAND_KEY_LENGTH = 40;
const COMMAND_NAME_LENGTH = 60;
const MARK_LABEL = /^[\p{L}\p{N}]{1,3}$/u;
const CUSTOM_MARK_COLOUR = /^#[0-9a-f]{6}$/;

/** The new Project as it is kept: without the spaces around what the user typed. */
export function trimmedNewProject(project: NewProject): NewProject {
  return {
    name: project.name.trim(),
    path: project.path.trim(),
    repositoryUrl: project.repositoryUrl?.trim(),
    baseBranch: project.baseBranch.trim(),
    mark: trimmedMark(project.mark),
    installCommand: project.installCommand.trim(),
    commands: project.commands.map(trimmedCommand),
    installInputs: trimmedInstallInputs(project.installInputs),
    publishingMode: project.publishingMode,
    defaultPipeline: project.defaultPipeline,
  };
}

/** Why a new Project's own fields can't be saved; what needs git or the Pipelines is checked apart. */
export function newProjectProblems(project: NewProject): string[] {
  const problems: string[] = [];
  const name = project.name.trim();
  if (name === "") problems.push("Give the Project a name.");
  else if (name.length > NAME_LENGTH) {
    problems.push(`A Project's name may be at most ${NAME_LENGTH} characters.`);
  }
  if (project.path.trim() === "") problems.push("Give the path to the repository.");
  if (project.baseBranch.trim() === "") problems.push("Give the base branch.");
  const wrongMark = markProblem(project.mark);
  if (wrongMark) problems.push(wrongMark);
  const installProblem = commandLineProblem(INSTALL_COMMAND_KEY, project.installCommand);
  if (installProblem) problems.push(installProblem);
  project.commands.forEach((command, index) => {
    problems.push(
      ...commandFieldsProblems(command, { blankAllowed: true }),
      ...commandKeyProblems(command.key, project.commands.slice(0, index)),
    );
  });
  problems.push(...installInputsProblems(project.installInputs));
  return problems;
}

/** The mark as it is kept: without the spaces around the label the user typed. */
export function trimmedMark(mark: ProjectMark): ProjectMark {
  return { label: mark.label.trim(), colour: mark.colour };
}

/** Why a mark can't be saved, or undefined when it can. */
export function markProblem(mark: ProjectMark): string | undefined {
  if (!MARK_LABEL.test(mark.label)) return "The mark's label is 1 to 3 letters or digits.";
  if (!isMarkColour(mark.colour)) return "The mark's colour is a named colour or #rrggbb.";
  return undefined;
}

function isMarkColour(colour: string): boolean {
  return NAMED_MARK_COLOURS.some((named) => named === colour) || CUSTOM_MARK_COLOUR.test(colour);
}

/** Why a Project limit can't be saved, or undefined when it can. */
export function projectLimitProblem(projectLimit: number): string | undefined {
  if (!Number.isInteger(projectLimit) || projectLimit < 1 || projectLimit > PROJECT_LIMIT_MAX) {
    return `The Project limit is a whole number of Tasks from 1 to ${PROJECT_LIMIT_MAX}.`;
  }
  return undefined;
}

/** The command by its key, or undefined when the Project has none by that key. */
export function commandOf(
  project: Pick<Project, "commands">,
  key: string,
): ProjectCommand | undefined {
  return project.commands.find((command) => command.key === key);
}

/** Whether two commands have the same name, kind, command line and re-run command. */
export function sameCommandFields(one: ProjectCommandFields, other: ProjectCommandFields): boolean {
  return (
    one.name === other.name &&
    one.kind === other.kind &&
    one.commandLine === other.commandLine &&
    one.rerunCommandLine === other.rerunCommandLine
  );
}

/** The command as it is kept: without the spaces around what was typed. */
export function trimmedCommand<Command extends ProjectCommandFields>(command: Command): Command {
  return {
    ...command,
    name: command.name.trim(),
    commandLine: command.commandLine.trim(),
    rerunCommandLine: command.rerunCommandLine.trim(),
  };
}

/**
 * Why `key` can't key a Project command or a test target, whose keys take one rule (spec §2.12):
 * lower-case letters, digits and `-`, starting with a letter, at most 40 characters. `owner` starts
 * the sentence, such as "A command's".
 */
export function keyShapeProblem(key: string, owner: string): string | undefined {
  if (!COMMAND_KEY.test(key)) {
    return `${owner} key is lower-case letters, digits and "-", starting with a letter; "${key}" is not.`;
  }
  if (key.length > COMMAND_KEY_LENGTH) {
    return `${owner} key may be at most ${COMMAND_KEY_LENGTH} characters.`;
  }
  return undefined;
}

/**
 * Why a key can't be a new command's beside `commands`: it must be lower-case letters, digits and
 * `-`, starting with a letter, unique in the Project, and neither install's nor Publish's.
 */
export function commandKeyProblems(key: string, commands: readonly ProjectCommand[]): string[] {
  const shapeProblem = keyShapeProblem(key, "A command's");
  if (shapeProblem) return [shapeProblem];
  if (RESERVED_COMMAND_KEYS.includes(key))
    return [`The key "${key}" is kept for The Office's own use.`];
  if (commands.some((command) => command.key === key)) {
    return [`The Project already has a command with the key "${key}".`];
  }
  return [];
}

/**
 * Why a command's name, kind and command line can't be saved. Once a command is added its command
 * line can't be blank; only a starting command given blank while adding a Project may be.
 */
export function commandFieldsProblems(
  command: ProjectCommandFields & { readonly key: string },
  { blankAllowed }: { readonly blankAllowed: boolean },
): string[] {
  const problems: string[] = [];
  const name = command.name.trim();
  if (name === "") problems.push(`Give the ${command.key} command a name.`);
  else if (name.length > COMMAND_NAME_LENGTH) {
    problems.push(`A command's name may be at most ${COMMAND_NAME_LENGTH} characters.`);
  }
  if (!PROJECT_COMMAND_KINDS.includes(command.kind)) {
    problems.push(`A command's kind is ${PROJECT_COMMAND_KINDS.join(", ")}.`);
  }
  const lineProblem = blankAllowed
    ? commandLineProblem(command.key, command.commandLine)
    : commandProblem(command.key, command.commandLine);
  if (lineProblem) problems.push(lineProblem);
  const rerunProblem = rerunCommandProblem(command);
  if (rerunProblem) problems.push(rerunProblem);
  return problems;
}

/** Why a re-run command can't be saved: one line, on a test command only; a blank one always can. */
function rerunCommandProblem(
  command: ProjectCommandFields & { readonly key: string },
): string | undefined {
  if (!isCommandSet(command.rerunCommandLine)) return undefined;
  if (command.kind !== "test") return "Only a test command has a re-run command.";
  if (/[\r\n]/.test(command.rerunCommandLine)) {
    return `The ${command.key} command's re-run command must be one line.`;
  }
  return undefined;
}

/**
 * Why a command line can't be set in place of the one the command has, or undefined when it can:
 * once a command is set it can be changed but not cleared.
 */
export function commandProblem(key: string, commandLine: string): string | undefined {
  if (commandLine.trim() === "") return `The ${key} command can't be empty.`;
  return commandLineProblem(key, commandLine);
}

/** Why a command line given while adding a Project can't be saved; a blank one is saved as not set. */
export function commandLineProblem(key: string, commandLine: string): string | undefined {
  if (/[\r\n]/.test(commandLine)) return `The ${key} command must be one line.`;
  return undefined;
}

/** Why a before or after publishing line can't be saved; a blank one is saved, and runs nothing. */
export function publishingLineProblem(
  line: PublishingLine,
  commandLine: string,
): string | undefined {
  return commandLineProblem(PUBLISHING_LINE_NAMES[line], commandLine);
}

/** Whether the Project has this command: one left blank while adding it is not set. */
export function isCommandSet(commandLine: string): boolean {
  return commandLine.trim() !== "";
}

/**
 * The install inputs as they are kept: each one once, without blanks, with `/` between folders
 * and without `.` folders, so `.\package-lock.json` and `package-lock.json` are one file.
 */
export function trimmedInstallInputs(installInputs: readonly string[]): string[] {
  const kept = installInputs
    .map((input) =>
      input
        .trim()
        .split(/[\\/]+/)
        .filter((folder) => folder !== ".")
        .join("/"),
    )
    .filter((input) => input !== "");
  return [...new Set(kept)];
}

/** Why install inputs can't be saved, naming each as it would be kept. */
export function installInputsProblems(installInputs: readonly string[]): string[] {
  return trimmedInstallInputs(installInputs)
    .filter((input) => !isInsideTheRepository(input))
    .map((input) => `An install input is a path inside the repository; "${input}" is not.`);
}

function isInsideTheRepository(input: string): boolean {
  const absolute = input.startsWith("/") || /^[a-z]:/i.test(input);
  return !absolute && !input.split("/").includes("..");
}

/**
 * An id for a Project named `name`, unlike every id in `taken`: the name in lowercase ASCII words
 * joined by dashes, short enough to name a folder in a worktree path (AGENTS.md, Project layout and
 * defaults).
 */
export function projectIdFor(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .slice(0, 24)
      .replace(/^-+|-+$/g, "") || "project";
  let id = base;
  for (let suffix = 2; taken.has(id); suffix++) id = `${base}-${suffix}`;
  return id;
}
