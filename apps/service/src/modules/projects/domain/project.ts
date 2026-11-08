import type { EngineModel } from "../../engine/index.js";
import type { ProjectEnvironment } from "./project-environment.js";
import type { ProjectImage } from "./project-image.js";

/** The commands a Project runs, each a command line for the platform's shell. */
export const PROJECT_COMMAND_KEYS = ["install", "build", "lint", "test"] as const;
export type ProjectCommandKey = (typeof PROJECT_COMMAND_KEYS)[number];
export type ProjectCommands = Readonly<Record<ProjectCommandKey, string>>;

/** How Publish ships a Task's branch, run by The Office's own git code (spec §9). */
export const PUBLISHING_MODES = ["push-and-pull-request", "merge"] as const;
export type PublishingMode = (typeof PUBLISHING_MODES)[number];

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
  /** Drawn on the mark's colour in place of its label; null when the Project has none. */
  readonly icon: ProjectImage | null;
  /** The larger image on the Project's page and card; null when the Project has none. */
  readonly logo: ProjectImage | null;
  readonly commands: ProjectCommands;
  /**
   * The files whose change makes a worktree install again, as paths inside the repository with
   * `/` between folders (spec §9).
   */
  readonly installInputs: readonly string[];
  readonly publishingMode: PublishingMode;
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
  readonly addedAt: Date;
}

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
  | "commands"
  | "installInputs"
  | "publishingMode"
  | "defaultPipeline"
> & {
  /** Given only for a clone, whose folder `path` then is. */
  readonly repositoryUrl?: string | undefined;
};

const NAME_LENGTH = 60;
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
    commands: {
      install: project.commands.install.trim(),
      build: project.commands.build.trim(),
      lint: project.commands.lint.trim(),
      test: project.commands.test.trim(),
    },
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
  for (const key of PROJECT_COMMAND_KEYS) {
    const problem = commandProblem(key, project.commands[key]);
    if (problem) problems.push(problem);
  }
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

/** Why a command line can't be saved, or undefined when it can. */
export function commandProblem(key: ProjectCommandKey, commandLine: string): string | undefined {
  if (commandLine.trim() === "") return `The ${key} command can't be empty.`;
  if (/[\r\n]/.test(commandLine)) return `The ${key} command must be one line.`;
  return undefined;
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
 * joined by dashes, short enough to name a folder in a worktree path (Build defaults).
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
