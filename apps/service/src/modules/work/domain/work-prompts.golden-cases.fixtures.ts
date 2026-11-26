import { defaultPromptTexts, type PromptTexts } from "../../prompt-templates/index.js";
import { askingBrief, askingInstructions, type AskingRecord } from "./asking.js";
import type { Author } from "./author.js";
import {
  initiativePlanningAfterRestartOpening,
  initiativePlanningBrief,
  initiativePlanningInstructions,
  initiativePlanningOpening,
  type InitiativePlanningProject,
  type InitiativePlanningRecord,
} from "./initiative-planning.js";
import type { TaskLinks } from "./linked-records.js";
import {
  makeAPlanOpening,
  planningAfterRestartOpening,
  planningBrief,
  planningInstructions,
  type PlanningPipeline,
  type PlanningRecord,
} from "./planning.js";
import {
  shapingBrief,
  shapingInstructions,
  shapingOpeningOf,
  type ShapingProject,
} from "./shaping.js";
import type { StateChange } from "./state-change.js";
import { taskWhoAskedSection } from "./who-asked.js";
import { WORK_PROMPT_TEMPLATES } from "./work-prompt-templates.js";
import {
  ANN_LEE,
  anIdea,
  anInitiative,
  aLink,
  aPlannedTask,
  aPlanningThread,
  aTask,
  BEN_ITO,
} from "./work.fixtures.js";

/*
 * The representative inputs of Work's instructions, openings and Briefs, each rendered as it is
 * now. `work-prompts.golden.ts` holds what each rendered before they became prompt templates; only
 * the calls below follow the functions' signatures.
 */

const at = new Date("2026-11-12T10:00:00.000Z");
const A_PLANNER: Author = { kind: "person", roleKey: "planner" };

const OFFICE_WIDE: readonly PlanningPipeline[] = [
  {
    id: "full",
    name: "Full",
    description: "For a change to the code.",
    stages: [{ name: "Implement", role: "developer" }, { name: "Tests" }, { name: "Publish" }],
  },
  {
    id: "document",
    name: "Document",
    description: "For a document as the result.",
    stages: [{ name: "Produce" }, { name: "Review & fix" }],
  },
];

const ADMIN_OWN: readonly PlanningPipeline[] = [
  {
    id: "admin-quick",
    name: "Quick",
    description: "For a one-line fix.",
    stages: [{ name: "Implement" }, { name: "Publish" }],
    projectId: "admin-panel",
    copiedFrom: { name: "Full" },
  },
  {
    id: "admin-full",
    name: "Admin full",
    description: "",
    stages: [{ name: "Implement" }, { name: "Tests" }, { name: "Publish" }],
    projectId: "admin-panel",
    copiedFrom: { name: "Full" },
    broken: ["Inserts Verify on Linux after Tests, which Full no longer has."],
  },
];

const NO_LINKS: TaskLinks = {
  waitsFor: [],
  waitingForIt: [],
  idea: undefined,
  initiative: undefined,
};

const NO_COMMANDS = { installCommand: "", commands: [] };

const COMMANDS = {
  installCommand: "npm ci",
  commands: [
    { key: "build", name: "Build", commandLine: "npm run build" },
    { key: "lint", name: "Lint", commandLine: "" },
  ],
};

const FEWEST_PLANNING: PlanningRecord = {
  task: aTask({ state: "planning", pipelineId: undefined }),
  stateChanges: [],
  project: { name: "Admin panel", baseBranch: "main", defaultPipeline: "full", ...NO_COMMANDS },
  worktree: undefined,
  links: NO_LINKS,
  attachments: [],
  pipelines: [],
};

const PLANNING_INITIATIVE = anInitiative({
  state: "active",
  outcome: "Accountants get usage as CSV.",
  pipelines: [{ projectId: "admin-panel", pipelineId: "full" }],
  shortName: "usage-exports",
});

const OTHER_INITIATIVE_TASK = aPlannedTask({
  id: "task-2",
  title: "Add the CSV writer",
  initiativeId: "initiative-1",
});

const ALL_PLANNING: PlanningRecord = {
  task: aPlannedTask({
    state: "ready",
    description: "Monthly, per Project.",
    filesToChange: ["apps/service/src/usage/", "apps/web/src/usage.tsx"],
    planConfirmed: false,
    definitionOfDone: ["The export downloads.", "Each row is one Project."],
    definitionOfDoneConfirmed: true,
    pipelineId: "admin-quick",
    proposedPipeline: { pipelineId: "full", reason: "It changes the service and the web." },
    autoMode: true,
    initiativeId: "initiative-1",
  }),
  stateChanges: [
    { from: undefined, to: "backlog", at, by: ANN_LEE },
    { from: "backlog", to: "planning", at, by: BEN_ITO },
  ],
  project: { name: "Admin panel", baseBranch: "main", defaultPipeline: "admin-full", ...COMMANDS },
  worktree: { path: "/office/worktrees/admin-panel/task-1", branch: "office/task-1" },
  links: {
    waitsFor: [OTHER_INITIATIVE_TASK],
    waitingForIt: [],
    idea: anIdea({ taskId: "task-1", state: "shaped", notes: "Monthly, for the accountant." }),
    initiative: PLANNING_INITIATIVE,
  },
  attachments: [aLink({ owner: { kind: "task", taskId: "task-1" } })],
  pipelines: [...OFFICE_WIDE, ...ADMIN_OWN],
  initiative: {
    initiative: PLANNING_INITIATIVE,
    tasks: [aTask({ initiativeId: "initiative-1" }), OTHER_INITIATIVE_TASK],
    blockers: new Map(),
    attachments: [],
    pipelineNames: new Map([["full", "Full"]]),
  },
  startsFrom: { branch: "initiative/usage-exports", initiativePipeline: "Full" },
};

const NOTES_ARE_DESCRIPTION: PlanningRecord = {
  ...FEWEST_PLANNING,
  task: aTask({ state: "planning", description: "Monthly, per Project." }),
  worktree: { path: "/office/worktrees/admin-panel/task-1", branch: "office/task-1" },
  links: { ...NO_LINKS, idea: anIdea({ notes: "Monthly, per Project." }) },
  pipelines: OFFICE_WIDE,
};

const FEWEST_ASKING: AskingRecord = {
  task: aTask({ state: "in-progress" }),
  projectName: "Admin panel",
  worktree: undefined,
  attachments: [],
  stageResults: [],
  diffSummary: undefined,
  handoverNotes: [],
};

const ALL_ASKING: AskingRecord = {
  task: aPlannedTask({
    state: "waiting-on-you",
    description: "After signing in, land on the page I came from.",
    filesToChange: ["apps/web/src/sign-in.tsx"],
    definitionOfDoneConfirmed: false,
  }),
  projectName: "Admin panel",
  worktree: { path: "/office/worktrees/admin-panel/task-1", branch: "office/task-1" },
  attachments: [aLink({ owner: { kind: "task", taskId: "task-1" } })],
  stageResults: ["- Implement: done.", "- Tests: failed, 2 tests."],
  diffSummary: " apps/web/src/sign-in.tsx | 4 ++--\n 1 file changed",
  handoverNotes: ["Kept the path in the query.", "Fixed the redirect loop."],
};

const SHAPING_PROJECTS: readonly ShapingProject[] = [
  { id: "admin-panel", name: "Admin panel", ownPipelines: ADMIN_OWN },
  { id: "service", name: "Service", ownPipelines: [] },
];

const INITIATIVE_PROJECTS: readonly InitiativePlanningProject[] = [
  {
    id: "admin-panel",
    name: "Admin panel",
    baseBranch: "main",
    defaultPipeline: "admin-full",
    ownPipelines: ADMIN_OWN,
    ...COMMANDS,
  },
  {
    id: "service",
    name: "Service",
    baseBranch: "trunk",
    defaultPipeline: "full",
    ownPipelines: [],
    ...NO_COMMANDS,
  },
];

const FEWEST_INITIATIVE_PLANNING: InitiativePlanningRecord = {
  initiative: anInitiative({ state: "active" }),
  threadId: "thread-1",
  waiting: [],
  record: "## The Initiative\n\nUsage exports.",
  tasks: [aTask({ state: "ready", initiativeId: "initiative-1" })],
  projects: [],
  pipelines: [],
};

const PLANNING_THREAD = "thread-9";
const EARLIER_PLANNING_THREAD = "thread-8";

const ALL_INITIATIVE_PLANNING: InitiativePlanningRecord = {
  initiative: anInitiative({
    state: "active",
    planningThreads: [
      aPlanningThread({ threadId: EARLIER_PLANNING_THREAD }),
      aPlanningThread({
        threadId: PLANNING_THREAD,
        autoMode: true,
        withUser: true,
        by: BEN_ITO,
        openedAt: new Date("2026-10-27T09:00:00.000Z"),
      }),
    ],
  }),
  threadId: PLANNING_THREAD,
  waiting: [
    { taskId: "task-4", question: "CSV or Excel?" },
    { taskId: undefined, question: "Which Projects?" },
  ],
  record: "## The Initiative\n\nUsage exports.",
  tasks: [
    aTask({ id: "task-1", title: "Export usage", initiativeId: "initiative-1", blockedBy: [] }),
    aTask({
      id: "task-2",
      title: "Show the export",
      projectId: "service",
      initiativeId: "initiative-1",
      blockedBy: ["task-1", "task-3"],
    }),
    aTask({
      id: "task-3",
      title: "Write the CSV",
      state: "planning",
      initiativeId: "initiative-1",
      initiativePlanningThreadId: PLANNING_THREAD,
    }),
    aTask({
      id: "task-4",
      title: "Pick the format",
      state: "planning",
      initiativeId: "initiative-1",
      initiativePlanningThreadId: PLANNING_THREAD,
      markedPlanned: true,
    }),
    aTask({
      id: "task-5",
      title: "Count the rows",
      state: "ready",
      initiativeId: "initiative-1",
      initiativePlanningThreadId: EARLIER_PLANNING_THREAD,
    }),
  ],
  projects: INITIATIVE_PROJECTS,
  pipelines: OFFICE_WIDE,
};

const STARTED_BY_THE_QUEUE: readonly StateChange[] = [
  { from: "planning", to: "ready", at, by: ANN_LEE },
  { from: "ready", to: "in-progress", at, by: { kind: "queue", queuedBy: BEN_ITO } },
];

/** Each case's text, by its name, as `prompts` render it: by default, every template's default. */
export function goldenCaseOutputs(
  prompts: PromptTexts = defaultPromptTexts(WORK_PROMPT_TEMPLATES),
): Record<string, string> {
  return {
    "shaping instructions": shapingInstructions(prompts),
    "planning instructions": planningInstructions(prompts),
    "Initiative planning instructions": initiativePlanningInstructions(prompts),
    "asking instructions": askingInstructions(prompts),
    "shaping opening of an Initiative shaped from an Idea": shapingOpeningOf(
      prompts,
      anInitiative(),
    ),
    "shaping opening of a created Initiative": shapingOpeningOf(
      prompts,
      anInitiative({ originIdeaId: undefined }),
    ),
    "Make a plan opening, auto mode off": makeAPlanOpening(prompts, false),
    "Make a plan opening, auto mode on": makeAPlanOpening(prompts, true),
    "planning after restart opening": planningAfterRestartOpening(prompts),
    "Initiative planning opening": initiativePlanningOpening(prompts),
    "Initiative planning after restart opening": initiativePlanningAfterRestartOpening(prompts),
    "planning Brief, fewest sections": planningBrief(prompts, FEWEST_PLANNING),
    "planning Brief, every section": planningBrief(prompts, ALL_PLANNING),
    "planning Brief, the Idea's notes are the Description": planningBrief(
      prompts,
      NOTES_ARE_DESCRIPTION,
    ),
    "planning Brief, an Idea with no notes, no Pipeline and a Broken default": planningBrief(
      prompts,
      {
        ...FEWEST_PLANNING,
        links: { ...NO_LINKS, idea: anIdea({ notes: "" }) },
        project: { ...FEWEST_PLANNING.project, defaultPipeline: "admin-full" },
        pipelines: [...OFFICE_WIDE, ...ADMIN_OWN],
      },
    ),
    "planning Brief, a Plan alone, confirmed, auto mode on": planningBrief(prompts, {
      ...FEWEST_PLANNING,
      task: aTask({ plan: "Keep the path.", planConfirmed: true, autoMode: true }),
      stateChanges: [{ from: "ready", to: "planning", at, by: A_PLANNER }],
    }),
    "planning Brief, a Bug with its details and its Kind's Pipeline": planningBrief(prompts, {
      ...FEWEST_PLANNING,
      task: aTask({
        state: "planning",
        pipelineId: undefined,
        kind: "bug",
        causedBy: "task-2",
        foundInVersion: "v1.14.2",
      }),
      links: {
        ...NO_LINKS,
        causedBy: aTask({ id: "task-2", title: "Passkeys on the sign-in page", state: "done" }),
      },
      project: { ...FEWEST_PLANNING.project, defaultPipeline: "admin-quick" },
      pipelines: [...OFFICE_WIDE, ...ADMIN_OWN],
    }),
    "asking Brief, fewest sections": askingBrief(prompts, FEWEST_ASKING),
    "asking Brief, every section": askingBrief(prompts, ALL_ASKING),
    "asking Brief, a worktree and Stage results alone": askingBrief(prompts, {
      ...FEWEST_ASKING,
      worktree: ALL_ASKING.worktree,
      stageResults: ALL_ASKING.stageResults,
    }),
    "shaping Brief, shaping, fewest sections": shapingBrief(
      prompts,
      anInitiative(),
      undefined,
      "## The Initiative\n\nUsage exports.",
      [],
      [],
    ),
    "shaping Brief, shaping, the Idea's Project and Projects": shapingBrief(
      prompts,
      anInitiative({ pipelines: [{ projectId: "admin-panel", pipelineId: "admin-quick" }] }),
      { id: "admin-panel", name: "Admin panel" },
      "## The Initiative\n\nUsage exports.",
      SHAPING_PROJECTS,
      OFFICE_WIDE,
    ),
    "shaping Brief, active and created, Projects with no own Pipelines": shapingBrief(
      prompts,
      anInitiative({
        state: "active",
        originIdeaId: undefined,
        pipelines: [{ projectId: "service", pipelineId: "gone" }],
      }),
      undefined,
      "## The Initiative\n\nUsage exports.",
      [{ id: "service", name: "Service", ownPipelines: [] }],
      OFFICE_WIDE,
    ),
    "Initiative planning Brief, fewest sections": initiativePlanningBrief(
      prompts,
      FEWEST_INITIATIVE_PLANNING,
    ),
    "Initiative planning Brief, every section": initiativePlanningBrief(
      prompts,
      ALL_INITIATIVE_PLANNING,
    ),
    "Initiative planning Brief, Plan the Initiative, no Decision on a Task":
      initiativePlanningBrief(prompts, {
        ...ALL_INITIATIVE_PLANNING,
        initiative: anInitiative({
          state: "active",
          planningThreads: [aPlanningThread({ threadId: "thread-10", by: ANN_LEE })],
        }),
        threadId: "thread-10",
        waiting: [{ taskId: undefined, question: "Which Projects?" }],
      }),
    "Who asked, created alone": taskWhoAskedSection(prompts, aTask(), []),
    "Who asked, started by the queue": taskWhoAskedSection(
      prompts,
      aTask({ createdBy: ANN_LEE }),
      STARTED_BY_THE_QUEUE,
    ),
  };
}
