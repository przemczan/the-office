import type {
  Action,
  ActionRun,
  ManualWorkflowList,
  Project,
  TestTarget,
} from "@the-office/contracts";

export const PROJECT: Project = {
  id: "admin-panel",
  name: "Admin panel",
  path: "/projects/admin-panel",
  baseBranch: "main",
  mark: { label: "AP", colour: "teal" },
  installCommand: "npm ci",
  commands: [
    {
      key: "build",
      name: "Build",
      kind: "build",
      commandLine: "npm run build",
      rerunCommandLine: "",
    },
    { key: "seed", name: "Seed", kind: "build", commandLine: "npm run seed", rerunCommandLine: "" },
  ],
  installInputs: ["package-lock.json"],
  publishingMode: "merge",
  defaultPipeline: "full",
  icon: { light: null, dark: null },
  logo: { light: null, dark: null },
  repositoryUrl: null,
  beforePublishingCommand: "",
  afterPublishingCommand: "",
  deleteMergedBranches: false,
  environment: { set: [], unset: [], prependPath: [] },
  useProjectSkills: true,
  projectSkillsOff: [],
  engine: {
    default: null,
    force: null,
    people: [],
    standIns: { useOwnList: false, engineIds: [] },
  },
  runEnvironment: "on",
  features: {
    "connected-devices": false,
    "test-targets": true,
    "github-issues": true,
    "run-environment": true,
    actions: true,
  },
  projectLimit: 1,
  addedAt: "2026-11-01T10:00:00.000Z",
  codeHost: null,
  kindDefaultPipelines: { feature: null, bug: null, chore: null },
  defaultPipelineOfKind: { feature: "full", bug: "full", chore: "full" },
  issueSettings: {
    autoImportLabel: null,
    closeOnDone: true,
    commentOnStartAndDone: false,
    closeOnDrop: false,
  },
};

export const BUILD: Extract<Action, { kind: "project-command" }> = {
  key: "build-it",
  name: "Build it",
  kind: "project-command",
  leavesTheWorkstation: false,
  settings: { commandKey: "build", commandsBefore: ["install", "gone"], timeLimitMinutes: null },
  setBy: { name: { by: "user", user: { userId: "u1", name: "Ada" } } },
};

export const INSTALL: Extract<Action, { kind: "test-target" }> = {
  key: "install-phone",
  name: "Install on my phone",
  kind: "test-target",
  leavesTheWorkstation: false,
  settings: { targetKey: "android" },
  setBy: {
    name: { by: "user", user: { userId: "u1", name: "Ada" } },
    settings: { by: "proposal", proposalId: "p1", agent: { roleKey: "devops", name: "Nina" } },
  },
};

export const RELEASE: Extract<Action, { kind: "workflow" }> = {
  key: "release",
  name: "Release",
  kind: "workflow",
  leavesTheWorkstation: true,
  settings: { file: "release.yml", inputs: {} },
  setBy: {},
};

export const GONE_TARGET: Action = {
  ...INSTALL,
  key: "install-tablet",
  name: "Install on my tablet",
  settings: { targetKey: "tablet" },
  setBy: {},
};

export const ANDROID: TestTarget = {
  key: "android",
  name: "Android app",
  kind: "build-to-install",
  entryPoint: { kind: "gradle-task", task: "assembleDebug", arguments: [] },
  outputPatterns: ["app/build/*.apk"],
  variables: [],
  secretVariables: [],
  commandsBefore: [],
  memoryMegabytes: null,
  setBy: {},
};

export const WORKFLOWS: ManualWorkflowList = {
  ref: "main",
  problem: null,
  workflows: [
    {
      id: "deploy.yml",
      name: "Deploy",
      url: "https://github.com/ada/admin-panel/actions/workflows/deploy.yml",
      inputs: [
        {
          name: "channel",
          description: "Where it goes.",
          required: true,
          default: "beta",
          kind: "choice",
          options: ["beta", "stable"],
        },
      ],
    },
  ],
};

/** A run of an Action, Succeeded on main by default. */
export function aRun(id: string, fields: Partial<ActionRun> = {}): ActionRun {
  return {
    id,
    projectId: PROJECT.id,
    actionKey: BUILD.key,
    actionName: BUILD.name,
    status: { kind: "project-command", state: "succeeded" },
    outcome: "succeeded",
    ranFrom: { kind: "branch" },
    branch: "main",
    commit: "f00ba1200000000000000000000000000000000",
    note: null,
    startedBy: { userId: "u1", name: "Ada" },
    startedAt: "2026-11-24T10:00:00.000Z",
    endedAt: "2026-11-24T10:04:00.000Z",
    exitCode: 0,
    endedBecause: null,
    testInstanceId: null,
    ciRun: null,
    workflowRunsUrl: null,
    ...fields,
  };
}

/** A uuid of its own for each number. */
export function uuid(number: number): string {
  return `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
}
