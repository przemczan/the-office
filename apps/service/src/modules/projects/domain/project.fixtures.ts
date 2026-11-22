import {
  STARTING_COMMANDS,
  type NewProject,
  type Project,
  type ProjectCommand,
} from "./project.js";
import { DEFAULT_ISSUE_SETTINGS } from "./issue-settings.js";
import { NO_KIND_DEFAULT_PIPELINES } from "./kind-default-pipeline.js";
import { UNCHANGED_ENVIRONMENT } from "./project-environment.js";
import { NO_PROJECT_IMAGE } from "./project-image.js";

const STARTING_LINES = { build: "npm run build", lint: "npm run lint", test: "npm test" };

/** Build, lint and test, as every Project starts with them, with these command lines or npm's. */
export function startingCommands(
  lines: Partial<Record<"build" | "lint" | "test", string>> = {},
): ProjectCommand[] {
  const given: Record<string, string | undefined> = { ...STARTING_LINES, ...lines };
  return STARTING_COMMANDS.map((command) => ({
    ...command,
    commandLine: given[command.key] ?? "",
    rerunCommandLine: "",
  }));
}

export function aNewProject(fields: Partial<NewProject> = {}): NewProject {
  return {
    name: "Admin panel",
    path: "/work/admin-panel",
    baseBranch: "main",
    mark: { label: "AP", colour: "teal" },
    installCommand: "npm ci",
    commands: startingCommands(),
    installInputs: ["package-lock.json"],
    publishingMode: "push-and-pull-request",
    defaultPipeline: "full",
    ...fields,
  };
}

export function aProject(fields: Partial<Project> = {}): Project {
  return {
    id: "admin-panel",
    ...aNewProject(),
    repositoryUrl: null,
    icon: NO_PROJECT_IMAGE,
    logo: NO_PROJECT_IMAGE,
    beforePublishingCommand: "",
    afterPublishingCommand: "",
    deleteMergedBranches: false,
    environment: UNCHANGED_ENVIRONMENT,
    useProjectSkills: true,
    projectSkillsOff: [],
    projectDefault: null,
    useForEveryRole: false,
    roleOverrides: [],
    runEnvironment: "not-decided",
    runEnvironmentSetUpProblems: [],
    projectLimit: 1,
    addedAt: new Date("2026-10-25T09:00:00.000Z"),
    kindDefaultPipelines: NO_KIND_DEFAULT_PIPELINES,
    issueSettings: DEFAULT_ISSUE_SETTINGS,
    ...fields,
  };
}
