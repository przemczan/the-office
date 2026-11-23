import type {
  CiRun,
  Idea,
  Initiative,
  Project,
  PullRequest,
  TaskSummary,
  TestInstance,
} from "@the-office/contracts";

// Records of the Shop Project as the Overview's tests read them.

export const NOW = new Date("2026-11-20T12:00:00.000Z");

export const PROJECT: Project = {
  id: "shop",
  name: "Shop",
  path: "/projects/shop",
  baseBranch: "main",
  mark: { label: "SH", colour: "teal" },
  installCommand: "npm ci",
  commands: [],
  installInputs: [],
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
    "connected-devices": true,
    "test-targets": true,
    "github-issues": true,
    "run-environment": true,
    actions: true,
  },
  projectLimit: 2,
  addedAt: "2026-11-01T10:00:00.000Z",
  codeHost: "GitHub",
  kindDefaultPipelines: { feature: null, bug: null, chore: null },
  defaultPipelineOfKind: { feature: "full", bug: "full", chore: "full" },
  issueSettings: {
    autoImportLabel: null,
    closeOnDone: true,
    commentOnStartAndDone: false,
    closeOnDrop: false,
  },
};

/** A record's id as the contracts take one, the `n`th. */
export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/** "2026-11-20T12:00:00.000Z" less `hours`. */
export function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 60 * 60_000).toISOString();
}

export function aTask(id: string, fields: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id,
    title: `Task ${id}`,
    projectId: PROJECT.id,
    priority: "normal",
    tags: [],
    state: "backlog",
    pausedBy: null,
    engineStandIns: [],
    resumesAt: null,
    autoMode: false,
    initiativePlanningThreadId: null,
    markedPlanned: false,
    hasPlanningThread: false,
    planConfirmed: false,
    filesToChange: [],
    estimatedTokens: null,
    definitionOfDoneConfirmed: false,
    commitMessagePublishedAt: null,
    pipelineId: "full",
    blockedBy: [],
    originIdeaId: null,
    engineOverride: null,
    initiativeEngineOverride: null,
    initiativeId: null,
    madeFor: null,
    resolvesTaskId: null,
    projectMoves: [],
    createdBy: { kind: "user", user: null },
    createdAt: "2026-11-01T10:00:00.000Z",
    archivedAt: null,
    endedAt: null,
    pullRequestEnd: null,
    kind: "feature",
    causedBy: null,
    foundInVersion: null,
    foundWhileWorkingOn: null,
    dropReason: null,
    ...fields,
  };
}

export function anIdea(id: string, fields: Partial<Idea> = {}): Idea {
  return {
    id,
    title: `Idea ${id}`,
    notes: "",
    projectId: PROJECT.id,
    state: "new",
    taskId: null,
    initiativeId: null,
    capturedBy: { kind: "user", user: null },
    capturedAt: hoursAgo(1),
    droppedAt: null,
    ...fields,
  };
}

export function anInitiative(id: string, fields: Partial<Initiative> = {}): Initiative {
  return {
    id,
    name: `Initiative ${id}`,
    outcome: "",
    state: "active",
    originIdeaId: null,
    projectIds: [PROJECT.id],
    createdBy: { kind: "user", user: null },
    createdAt: "2026-11-01T10:00:00.000Z",
    endedAt: null,
    archivedAt: null,
    pausedAt: null,
    planningThreadId: null,
    planningAutoMode: false,
    pipelines: [],
    engineOverride: null,
    shortName: null,
    branches: [],
    ...fields,
  };
}

export function aCiRun(id: number, fields: Partial<CiRun> = {}): CiRun {
  return {
    id,
    projectId: PROJECT.id,
    number: id,
    attempt: 1,
    workflow: "CI",
    title: `Run ${id}`,
    trigger: "push",
    branch: PROJECT.baseBranch,
    commit: "0123456789abcdef0123456789abcdef01234567",
    status: "succeeded",
    startedAt: hoursAgo(2),
    updatedAt: hoursAgo(2),
    url: `https://github.com/acme/shop/actions/runs/${id}`,
    taskId: null,
    ...fields,
  };
}

export function aPullRequest(number: number, fields: Partial<PullRequest> = {}): PullRequest {
  return {
    id: uuid(1000 + number),
    projectId: PROJECT.id,
    taskId: "11111111-1111-4111-8111-111111111111",
    number,
    url: `https://github.com/acme/shop/pull/${number}`,
    title: `Pull request ${number}`,
    branch: `office/${number}`,
    baseBranch: PROJECT.baseBranch,
    openedAt: hoursAgo(3),
    checks: "passing",
    mergeable: "yes",
    checkedAt: hoursAgo(1),
    stale: false,
    ...fields,
  };
}

export function anInstance(id: string, fields: Partial<TestInstance> = {}): TestInstance {
  return {
    id,
    initiativeId: null,
    projectId: PROJECT.id,
    branch: "main",
    targetKey: "web",
    targetName: "Web app",
    kind: "hosted",
    state: "running",
    commit: null,
    port: 4500,
    failedReason: null,
    launchedBy: { kind: "user", user: null },
    launchedAt: hoursAgo(1),
    runningAt: hoursAgo(1),
    endedAt: null,
    files: [],
    filesRemoved: false,
    ...fields,
  };
}
