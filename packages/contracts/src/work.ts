import { z } from "zod";
import { webEventSchema } from "./events.js";
import { engineIdSchema } from "./engines.js";
import { officeAction } from "./office-actions.js";
import { pageQuerySchema, pageSchemaOf } from "./paging.js";
import { personEngineSettingsSchema } from "./people.js";
import { projectFilterParamSchema } from "./project-filter.js";
import { mergeMethodSchema } from "./pull-requests.js";
import { userRefSchema } from "./users.js";
import {
  initiativeStateSchema,
  taskStateSchema,
  type InitiativeState,
  type TaskState,
} from "./work-states.js";

export {
  initiativeStateSchema,
  taskStateSchema,
  type InitiativeState,
  type TaskState,
} from "./work-states.js";

/**
 * Who captured, created or attached something: a user, or a person by their Role's key. `user` is
 * null on a record from before users existed, not yet claimed by the first user.
 */
export const authorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("user"),
    user: userRefSchema.nullable(),
    /** The person, by their Role's key, who proposed what the user applied from a Proposal. */
    proposedBy: z.string().optional(),
  }),
  z.object({
    kind: z.literal("person"),
    roleKey: z.string(),
    /** The user who asked for what the person did. */
    askedBy: userRefSchema.optional(),
    /** The user who allowed the call the person made, where it was held for approval. */
    allowedBy: userRefSchema.optional(),
  }),
]);
export type Author = z.infer<typeof authorSchema>;

/** A Task's Kind (spec §2.1): what it is, which decides its default Pipeline and its commit type. */
export const TASK_KINDS = ["feature", "bug", "chore"] as const;
export const taskKindSchema = z.enum(TASK_KINDS);
export type TaskKind = z.infer<typeof taskKindSchema>;

/**
 * Why a Task was Dropped: Duplicate names the Task it duplicates, Other the user's words; the
 * others take nothing.
 */
export const dropReasonSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("wont-fix") }),
  z.object({ kind: z.literal("duplicate"), taskId: z.uuid() }),
  z.object({ kind: z.literal("cant-reproduce") }),
  z.object({ kind: z.literal("other"), text: z.string().trim().min(1).max(500) }),
]);
export type DropReason = z.infer<typeof dropReasonSchema>;

/** Who created a Task, as the read model gives it: an Author, or The Office itself. */
export const taskCreatorSchema = z.union([authorSchema, z.object({ kind: z.literal("office") })]);
export type TaskCreator = z.infer<typeof taskCreatorSchema>;

export const ideaStateSchema = z.enum(["new", "shaped", "dropped"]);
export type IdeaState = z.infer<typeof ideaStateSchema>;

/** What the user gives to capture an Idea (POST /ideas); a null Project is Office-wide. */
export const newIdeaSchema = z.object({
  title: z.string(),
  notes: z.string(),
  projectId: z.string().nullable(),
});
export type NewIdea = z.infer<typeof newIdeaSchema>;

/** PUT /ideas/:id: the Idea's title, notes and Project, editable until it is shaped. */
export const ideaEditSchema = newIdeaSchema;
export type IdeaEdit = z.infer<typeof ideaEditSchema>;

export const ideaSchema = newIdeaSchema.extend({
  id: z.uuid(),
  state: ideaStateSchema,
  /** The Task it was shaped into. */
  taskId: z.uuid().nullable(),
  /** The Initiative it was shaped into. */
  initiativeId: z.uuid().nullable(),
  /**
   * The Task it was found while working on, set as it is captured in a person's Thread on that
   * Task and never changed; null for none.
   */
  foundWhileWorkingOn: z.uuid().nullable(),
  capturedBy: authorSchema,
  capturedAt: z.iso.datetime(),
  droppedAt: z.iso.datetime().nullable(),
});
export type Idea = z.infer<typeof ideaSchema>;

export const ideaListSchema = z.array(ideaSchema);

/**
 * POST /ideas/:id/shape: the Project the Task is made in, and its Kind (Feature when left out). A
 * Description is sent only for a Bug from an Idea without notes.
 */
export const ideaShapingSchema = z.object({
  projectId: z.string(),
  kind: taskKindSchema.optional(),
  description: z.string().optional(),
});
export type IdeaShaping = z.infer<typeof ideaShapingSchema>;

/** The Initiative's branch in one Project it spans, made at Confirm or when it first spans it. */
export const initiativeBranchSchema = z.object({
  projectId: z.string(),
  branch: z.string(),
  madeAt: z.iso.datetime(),
});
export type InitiativeBranch = z.infer<typeof initiativeBranchSchema>;

/**
 * A branch of a Task or an Initiative and whether this repository still knows it, as its local
 * branch or a remote-tracking ref, without fetching (spec 5.5, "Deleting merged branches").
 */
export const knownBranchSchema = z.object({
  projectId: z.string(),
  branch: z.string(),
  known: z.boolean(),
});
export type KnownBranch = z.infer<typeof knownBranchSchema>;

/**
 * GET /tasks/:id/branch: the Task's own branch; null for a Publishing Task or a Conflict resolution
 * Task, which hold none.
 */
export const taskBranchSchema = z.object({ branch: knownBranchSchema.nullable() });
export type TaskBranch = z.infer<typeof taskBranchSchema>;

/** GET /initiatives/:id/branches: the Initiative's branch in each Project, in `branches`' order. */
export const initiativeKnownBranchesSchema = z.object({ branches: z.array(knownBranchSchema) });
export type InitiativeKnownBranches = z.infer<typeof initiativeKnownBranchesSchema>;

/**
 * The Initiative's Pipeline in one Project it spans (spec 2.1): an office-wide Pipeline or that
 * Project's own, which its Publishing Task there follows; null for None, which publishes Task by Task.
 */
export const initiativePipelineSchema = z.object({
  projectId: z.string(),
  pipelineId: z.string().nullable(),
});
export type InitiativePipeline = z.infer<typeof initiativePipelineSchema>;

/**
 * POST /ideas/:id/initiative makes one, being shaped, as does create_initiative in the chat of
 * whoever shapes Initiatives or is the Default person to talk to; its Tasks name it.
 */
export const initiativeSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** Empty until written. */
  outcome: z.string(),
  state: initiativeStateSchema,
  /** The Idea it was shaped from; null for one created with create_initiative. */
  originIdeaId: z.uuid().nullable(),
  /** The Projects of its Tasks, each once. */
  projectIds: z.array(z.string()),
  createdBy: authorSchema,
  createdAt: z.iso.datetime(),
  /**
   * When it became Done or Dropped; null while it is shaping or active, and for one that ended
   * before this was kept.
   */
  endedAt: z.iso.datetime().nullable(),
  /** Set while it is in the Archive, a mark beside its Done or Dropped state. */
  archivedAt: z.iso.datetime().nullable(),
  /**
   * Set while it is paused (POST /initiatives/:id/pause), a mark beside its active state: none of
   * its Tasks runs or starts until it is resumed.
   */
  pausedAt: z.iso.datetime().nullable(),
  /**
   * Its latest planning Thread with the Planner (POST /initiatives/:id/planning), one of its
   * Threads; null until it is first planned.
   */
  planningThreadId: z.uuid().nullable(),
  /** Whether its latest planning Thread plans its Tasks in auto mode. */
  planningAutoMode: z.boolean(),
  /** The Initiative's Pipeline in each Project it spans (spec 2.1), in `projectIds`' order. */
  pipelines: z.array(initiativePipelineSchema),
  /** The Short name its branches are named by (spec 5.5); null while no Project has a Pipeline. */
  shortName: z.string().nullable(),
  /** The Initiative's branch in each Project, as The Office made it; kept after a Drop. */
  branches: z.array(initiativeBranchSchema),
  /**
   * The Initiative's engine override (spec 5.4.5): its Threads and every Task in it with no
   * override of its own run on this engine, with no Stand-in Engines; null for none.
   */
  engineOverride: engineIdSchema.nullable(),
});
export type Initiative = z.infer<typeof initiativeSchema>;

/**
 * PUT /tasks/:id/engine and PUT /initiatives/:id/engine: the Task's or the Initiative's engine
 * override, an engine only, null to clear it; refused for an engine not listed, once it is Done or
 * Dropped, and by the capability check.
 */
export const workEngineChangeSchema = z.object({ engineId: engineIdSchema.nullable() });
export type WorkEngineChange = z.infer<typeof workEngineChangeSchema>;

/**
 * One person's model and effort on each engine type, as a Project keeps them for a person (a type
 * left out is the level below). Named for the Task, whose setting for the person it is.
 */
export const taskPersonEngineSettingsSchema = z.object({
  roleKey: z.string(),
  engineSettings: personEngineSettingsSchema,
});
export type TaskPersonEngineSettings = z.infer<typeof taskPersonEngineSettingsSchema>;

/**
 * PUT /tasks/:id/engine: the Task's engine override (as `workEngineChangeSchema`) and its setting
 * for each person; `people` left out keeps the saved settings, null or empty clears them. Refused
 * for a model or effort the engine type doesn't offer, a person named twice, and once it is Done or
 * Dropped.
 */
export const taskEngineChangeSchema = workEngineChangeSchema.extend({
  people: z.array(taskPersonEngineSettingsSchema).nullable().optional(),
});
export type TaskEngineChangeRequest = z.infer<typeof taskEngineChangeSchema>;

/**
 * PUT /initiatives/:id/pipeline: the Initiative's Pipeline in one Project it spans, chosen while
 * shaping from the office-wide Pipelines and that Project's own; null for None.
 */
export const initiativePipelineChoiceSchema = z.object({
  projectId: z.string(),
  pipelineId: z.string().nullable(),
});
export type InitiativePipelineChoice = z.infer<typeof initiativePipelineChoiceSchema>;

/**
 * PUT /initiatives/:id/pipelines: the Pipelines block saved as a whole while shaping, so a refusal
 * leaves nothing half-saved: the Pipeline in each Project, null for None, each Project once, and
 * the Short name its branch is named by, null to keep the one it has or derive one from the title.
 */
export const initiativePipelinesChangeSchema = z.object({
  pipelines: z
    .array(initiativePipelineChoiceSchema)
    .refine(
      (choices) => new Set(choices.map(({ projectId }) => projectId)).size === choices.length,
      "Name each Project once.",
    ),
  shortName: z.string().nullable(),
});
export type InitiativePipelinesChange = z.infer<typeof initiativePipelinesChangeSchema>;

/** PUT /initiatives/:id/short-name: the user's Short name, edited while shaping. */
export const shortNameChangeSchema = z.object({ shortName: z.string() });
export type ShortNameChange = z.infer<typeof shortNameChangeSchema>;

/** The longest a Short name may be (spec 5.5). */
export const SHORT_NAME_MAX_LENGTH = 40;

/** The Initiative's branch named by its Short name (spec 5.5). */
export function initiativeBranchOf(shortName: string): string {
  return `initiative/${shortName}`;
}

/**
 * POST /initiatives/:id/planning, Plan the Initiative: whether its Tasks are planned in auto mode,
 * which also becomes the remembered default.
 */
export const initiativePlanningSchema = z.object({ autoMode: z.boolean() });
export type InitiativePlanningRequest = z.infer<typeof initiativePlanningSchema>;

/**
 * GET /initiatives: every Initiative, archived ones too (the Initiatives board leaves those out),
 * the newest first; with `query`, those whose name or outcome matches it.
 */
export const initiativeListSchema = z.array(initiativeSchema);

/** How many archived Initiatives a page of GET /initiatives/archived holds. */
export const ARCHIVE_PAGE_SIZE = 25;

export const archiveStateFilterSchema = z.enum(["all", "done", "dropped"]);
export type ArchiveStateFilter = z.infer<typeof archiveStateFilterSchema>;

/**
 * The query of GET /initiatives/archived: the words of a search of names and outcomes, the Done /
 * Dropped / All filter, the page counting from 1, and the Projects the Project filter shows as one
 * `project` each, every Project when none is named.
 */
export const archivedInitiativesQuerySchema = z.object({
  query: z.string().default(""),
  state: archiveStateFilterSchema.default("all"),
  page: z.coerce.number().int().min(1).default(1),
  project: projectFilterParamSchema(),
});
export type ArchivedInitiativesQuery = z.infer<typeof archivedInitiativesQuerySchema>;

/** An archived Initiative with its final count: its Tasks done of those it kept (not Dropped). */
export const archivedInitiativeSchema = initiativeSchema.extend({
  tasksDone: z.number().int().min(0),
  tasksCounted: z.number().int().min(0),
});
export type ArchivedInitiative = z.infer<typeof archivedInitiativeSchema>;

/**
 * A page of the Archive of Initiatives, the one that ended last on top; `counts` are how many
 * match each state with the search and the Project filter, `total` how many the state filter
 * leaves of them.
 */
export const archivedInitiativesPageSchema = z.object({
  initiatives: z.array(archivedInitiativeSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  counts: z.object({ done: z.number().int().min(0), dropped: z.number().int().min(0) }),
});
export type ArchivedInitiativesPage = z.infer<typeof archivedInitiativesPageSchema>;

/** PUT /initiatives/:id/outcome: the user's outcome, written while the Initiative is being shaped. */
export const outcomeChangeSchema = z.object({ outcome: z.string() });
export type OutcomeChange = z.infer<typeof outcomeChangeSchema>;

/** What holds a Paused Task apart from a Pause of the user's own. */
export const taskHolderSchema = z.enum(["alarm", "initiative", "usage-window"]);
export type TaskHolder = z.infer<typeof taskHolderSchema>;

/** Highest first. */
export const prioritySchema = z.enum(["high", "normal", "low"]);
export type Priority = z.infer<typeof prioritySchema>;

/** What creating a Task takes (POST /tasks); it starts in Backlog. */
export const newTaskSchema = z.object({
  title: z.string(),
  /** What the user wants, in their own words (spec §2.1); none when left out. */
  description: z.string().default(""),
  projectId: z.string(),
  priority: prioritySchema,
  /** Free-form words to find it by; the service keeps each lower-case, once. None when left out. */
  tags: z.array(z.string()).default([]),
  /** Feature, Bug or Chore; Feature when left out. */
  kind: taskKindSchema.default("feature"),
});
export type NewTask = z.input<typeof newTaskSchema>;

/** What "Add a Task" on an Initiative takes (POST /initiatives/:id/tasks): the Tasks it must wait for too. */
export const newInitiativeTaskSchema = newTaskSchema.extend({ blockedBy: z.array(z.uuid()) });
export type NewInitiativeTask = z.input<typeof newInitiativeTaskSchema>;

/**
 * Why a Task's conversations can be read but not continued, for the states where no session works
 * on it: Shaping until its Initiative is confirmed; then for good once Done (Publish removed its
 * worktree) or Dropped (the user ended it).
 */
export const CLOSED_TASK_CONVERSATION_WORDS: Readonly<Partial<Record<TaskState, string>>> = {
  shaping:
    "This Task is in Shaping, so you can read this conversation but not continue it until its Initiative is confirmed.",
  done: "This Task is Done and its working copy has been removed, so you can read this conversation but not continue it. To keep working, start a new Task.",
  dropped:
    "This Task was dropped, so you can read this conversation but not continue it. To work on it again, start a new Task.",
};

/** Why an Initiative's Threads can be read but not continued, for the states that end it. */
export const ENDED_INITIATIVE_CONVERSATION_WORDS: Readonly<
  Partial<Record<InitiativeState, string>>
> = {
  done: "This Initiative is done, so you can read this conversation but not continue it.",
  dropped: "This Initiative was dropped, so you can read this conversation but not continue it.",
};

/** A Pipeline the Planner proposes for a Task, with why it fits the Definition of Done. */
export const proposedPipelineSchema = z.object({ pipelineId: z.string(), reason: z.string() });
export type ProposedPipeline = z.infer<typeof proposedPipelineSchema>;

/** Tokens as every token count gives them: input, output and cache writes. */
const estimatedTokensSchema = z.number().int().positive();

/** A Task's Move from one Project to another (POST /tasks/:id/move). */
export const projectMoveSchema = z.object({
  from: z.string(),
  to: z.string(),
  at: z.iso.datetime(),
  by: authorSchema,
});
export type ProjectMove = z.infer<typeof projectMoveSchema>;

/**
 * A Stand-in Engine the Task's run works on in place of the cascade's engine, as its last Start
 * chose it: both engines with their names at Start, and why, in full and short.
 */
export const engineStandInSchema = z.object({
  engineId: z.string(),
  engineName: z.string(),
  standInId: z.string(),
  standInName: z.string(),
  reason: z.string(),
  short: z.string(),
});
export type EngineStandIn = z.infer<typeof engineStandInSchema>;

/** Who ended a Task's pull request: a user, from Work › Pull requests, or someone on its code host. */
export const pullRequestEndedBySchema = z.discriminatedUnion("kind", [
  ...authorSchema.options,
  /** Someone on the code host, by its name, such as GitHub. */
  z.object({ kind: z.literal("code-host"), name: z.string().min(1) }),
]);
export type PullRequestEndedBy = z.infer<typeof pullRequestEndedBySchema>;

/** How a Task's pull request ended, as its page and record show it. */
export const pullRequestEndSchema = z.object({
  outcome: z.enum(["merged", "closed"]),
  number: z.number().int().positive(),
  url: z.url(),
  at: z.iso.datetime(),
  /** How it was merged; null when it was closed, or merged on the code host. */
  method: mergeMethodSchema.nullable(),
  by: pullRequestEndedBySchema,
});
export type PullRequestEnd = z.infer<typeof pullRequestEndSchema>;

/** What The Office makes a Task for (spec §2.1, "Tasks The Office makes"). */
export const TASK_MADE_FOR = [
  "onboard",
  "run-environment-setup",
  "test-targets-setup",
  "publishing",
  "resolve-conflicts",
] as const;
export type TaskMadeFor = (typeof TASK_MADE_FOR)[number];

/**
 * The Tasks The Office makes and starts at once, kept off the board: Off-board Tasks (spec §2.1,
 * "Off-board Tasks"). Still Tasks, with their page, Stages, Decisions and Publish.
 */
export const OFF_BOARD_TASK_MADE_FOR = ["onboard", "run-environment-setup"] as const;
export type OffBoardTaskKind = (typeof OFF_BOARD_TASK_MADE_FOR)[number];
export const offBoardTaskKindSchema = z.enum(OFF_BOARD_TASK_MADE_FOR);

export function isOffBoardTask(task: { readonly madeFor: TaskMadeFor | null }): boolean {
  return (OFF_BOARD_TASK_MADE_FOR as readonly (TaskMadeFor | null)[]).includes(task.madeFor);
}

export const taskSchema = newTaskSchema.extend({
  id: z.uuid(),
  state: taskStateSchema,
  /**
   * What holds it Paused apart from the user's own Pause, null for that and every other state: the
   * fire alarm, whose all clear resumes it; its Initiative's Pause; or its engine's usage window,
   * used up until `resumesAt`.
   */
  pausedBy: taskHolderSchema.nullable(),
  /** When a Task the usage window paused resumes by itself, its window's reset; null otherwise. */
  resumesAt: z.iso.datetime().nullable(),
  /**
   * The Stand-in Engines its run works on in place of the cascade's engines, as its last Start
   * chose them; empty while every Stage runs on the cascade's.
   */
  engineStandIns: z.array(engineStandInSchema),
  plan: z.string(),
  /** False while the Plan is the Planner's proposal; true once the user confirmed or edited it. */
  planConfirmed: z.boolean(),
  /**
   * The files and folders the Plan expects to change, written and confirmed with it; a folder
   * covers the files under it. Start warns of an Overlap on them.
   */
  filesToChange: z.array(z.string()),
  /**
   * The Planner's estimate of the tokens the whole Pipeline will use, written and confirmed with
   * the Plan; null when it gave none.
   */
  estimatedTokens: estimatedTokensSchema.nullable(),
  definitionOfDone: z.array(z.string()),
  /** As `planConfirmed`, for the Definition of Done. */
  definitionOfDoneConfirmed: z.boolean(),
  /**
   * The message of the one commit Publish lands the Task as: the one written, or the default (the
   * title with a short summary below it) while `commitMessageWritten` is false.
   */
  commitMessage: z.string(),
  commitMessageWritten: z.boolean(),
  /** When Publish landed the commit message, which no longer changes from then on. */
  commitMessagePublishedAt: z.iso.datetime().nullable(),
  /** The Pipeline its work follows; null until one is chosen, which Ready needs. */
  pipelineId: z.string().nullable(),
  /** The Pipeline the Planner proposes, until the user confirms it or chooses another. */
  proposedPipeline: proposedPipelineSchema.nullable(),
  /**
   * Planned in auto mode, chosen at Make a plan: once the Planner marks it planned with no Decision
   * open, The Office confirms what is unconfirmed and marks it Ready. Counts only in Planning.
   */
  autoMode: z.boolean(),
  /**
   * The Initiative's planning Thread it is planned in, from its move to Planning there; null when
   * it is planned in a Thread of its own, or not at all.
   */
  initiativePlanningThreadId: z.uuid().nullable(),
  /** Whether the Planner marked it planned since it last moved to Planning. */
  markedPlanned: z.boolean(),
  /**
   * Whether it has a planning Thread, its own or its Initiative's, from its move to Planning. A
   * changing Save takes a Ready Task that has one back to Planning, and one that hasn't (marked
   * Ready from Backlog) to Backlog.
   */
  hasPlanningThread: z.boolean(),
  /** The Tasks that must be Done before it can start, in the order added; a Dropped one no longer blocks. */
  blockedBy: z.array(z.uuid()),
  originIdeaId: z.uuid().nullable(),
  /** The Initiative it is part of (POST /initiatives/:id/tasks). */
  initiativeId: z.uuid().nullable(),
  /**
   * The Task's engine override (spec 5.4.5): every session about it runs on this engine, with no
   * Stand-in Engines; null for none.
   */
  engineOverride: engineIdSchema.nullable(),
  /** Its Initiative's engine override, which applies while it has none; null for none or no Initiative. */
  initiativeEngineOverride: engineIdSchema.nullable(),
  /**
   * The Task's setting for each person it names, on each engine type (spec 5.4.5): the most
   * specific level of the model and effort cascade; empty while none is set.
   */
  peopleEngineSettings: z.array(taskPersonEngineSettingsSchema),
  /**
   * What The Office made it for: a Project's Onboard Task, its "Set up the run environment" Task,
   * an Initiative's Publishing Task, or a Conflict resolution Task; null for any other Task.
   */
  madeFor: z.enum(TASK_MADE_FOR).nullable(),
  /**
   * The Task whose pull request a Conflict resolution Task resolves the conflicts of; null for any
   * other Task.
   */
  resolvesTaskId: z.uuid().nullable(),
  /** Each Move to another Project, oldest first. */
  projectMoves: z.array(projectMoveSchema),
  /** Who created it: an Author, or The Office for a Task it made (or imported by itself). */
  createdBy: taskCreatorSchema,
  createdAt: z.iso.datetime(),
  /** The Task whose work caused this Bug; null for none. */
  causedBy: z.uuid().nullable(),
  /** The version the Bug was found in, free text; null for none. */
  foundInVersion: z.string().nullable(),
  /**
   * The Task it was found while working on, set as it is created (by a Bug Task Decision, or in a
   * person's Thread on that Task) and never changed; null for none.
   */
  foundWhileWorkingOn: z.uuid().nullable(),
  /** Why it was Dropped, when the user gave a reason; null otherwise. */
  dropReason: dropReasonSchema.nullable(),
  /**
   * When it was archived, while it is: a mark on a Done or Dropped Task, never a state, that takes
   * it off the board and its lists; null on the board.
   */
  archivedAt: z.iso.datetime().nullable(),
  /**
   * When it last moved to Done or Dropped; null while it hasn't ended, and for one whose end was
   * never recorded.
   */
  endedAt: z.iso.datetime().nullable(),
  /**
   * How its pull request ended, merged or closed, from Work › Pull requests or on the code host; a
   * mark beside its state, never one. Null while it has none, or its pull request is open again.
   */
  pullRequestEnd: pullRequestEndSchema.nullable(),
});
export type Task = z.infer<typeof taskSchema>;

/**
 * A Task without its long texts, which only the Task itself answers (GET /tasks/:id): what the
 * board and the lists of Tasks read.
 */
export const taskSummarySchema = taskSchema.omit({
  description: true,
  plan: true,
  definitionOfDone: true,
  commitMessage: true,
  commitMessageWritten: true,
  proposedPipeline: true,
});
export type TaskSummary = z.infer<typeof taskSummarySchema>;

/**
 * The Tasks GET /tasks answers: those on the board (never an archived one) in the board's order,
 * by priority, then by manual order; with `archived=true` the archived ones, archived last first.
 */
export const taskListSchema = z.array(taskSummarySchema);

/** The groups of a person's Work tab, as the user asks about their Tasks. */
export const workFilterSchema = z.enum([
  "all",
  "not-started",
  "in-progress",
  "waiting-on-you",
  "done",
  "dropped",
]);
export type WorkFilter = z.infer<typeof workFilterSchema>;

/**
 * The query of GET /roles/:roleKey/tasks: the Work filter, the Projects the Project filter shows as
 * one `project` each (every Project when none is named), and the page's cursor.
 */
export const personTasksQuerySchema = pageQuerySchema.extend({
  filter: workFilterSchema.default("all"),
  project: projectFilterParamSchema(),
});
export type PersonTasksQuery = z.infer<typeof personTasksQuerySchema>;

/** A Task the person has a part in, and that part in a few words ("Created it · Implement"). */
export const personTaskSchema = z.object({ task: taskSchema, part: z.string() });
export type PersonTask = z.infer<typeof personTaskSchema>;

/**
 * GET /roles/:roleKey/tasks: a page of the person's Tasks in the filter, the newest created first.
 * `counts` are how many each Work filter holds in the Projects the Project filter shows, and
 * `elsewhere` how many of the person's Tasks it hides.
 */
export const personTaskPageSchema = pageSchemaOf(personTaskSchema).extend({
  counts: z.record(workFilterSchema, z.number().int().nonnegative()),
  elsewhere: z.number().int().nonnegative(),
});
export type PersonTaskPage = z.infer<typeof personTaskPageSchema>;

/**
 * A Project's onboarding, read from its latest Onboard Task: onboarding until the Task is done,
 * then onboarded. A Project without one, or whose latest Onboard Task was dropped, has none.
 */
export const onboardingStateSchema = z.enum(["onboarding", "onboarded"]);
export type OnboardingState = z.infer<typeof onboardingStateSchema>;

export const projectOnboardingSchema = z.object({
  projectId: z.string(),
  /** The Project's Onboard Task. */
  taskId: z.uuid(),
  state: onboardingStateSchema,
});
export type ProjectOnboarding = z.infer<typeof projectOnboardingSchema>;

/** GET /onboardings: every Project that has an onboarding; one not listed has none. */
export const projectOnboardingListSchema = z.array(projectOnboardingSchema);

/** PUT /tasks/:id/priority */
export const priorityChangeSchema = z.object({ priority: prioritySchema });
export type PriorityChange = z.infer<typeof priorityChangeSchema>;

/**
 * POST /tasks/:id/make-a-plan: whether the Task is planned in auto mode, which also becomes the
 * remembered default.
 */
export const makeAPlanSchema = z.object({ autoMode: z.boolean() });
export type MakeAPlan = z.infer<typeof makeAPlanSchema>;

/** PUT /tasks/:id/description: the Description as the user rewrote it; empty leaves none. */
export const descriptionChangeSchema = z.object({ description: z.string() });
export type DescriptionChange = z.infer<typeof descriptionChangeSchema>;

/** PUT /tasks/:id/title: the Task's new title, until it is Done or Dropped. */
export const titleChangeSchema = z.object({ title: z.string() });
export type TitleChange = z.infer<typeof titleChangeSchema>;

/** PUT /tasks/:id/kind: the Task's Kind, until it is Done or Dropped. */
export const kindChangeSchema = z.object({ kind: taskKindSchema });
export type KindChange = z.infer<typeof kindChangeSchema>;

/** PUT /tasks/:id/caused-by: the Task whose work caused this Bug, or null for none. */
export const causedByChangeSchema = z.object({ causedBy: z.uuid().nullable() });
export type CausedByChange = z.infer<typeof causedByChangeSchema>;

/** PUT /tasks/:id/found-in-version: the version the Bug was found in, free text, or null for none. */
export const foundInVersionChangeSchema = z.object({
  foundInVersion: z.string().trim().min(1).max(64).nullable(),
});
export type FoundInVersionChange = z.infer<typeof foundInVersionChangeSchema>;

/** POST /tasks/:id/drop: the body is optional, and so is the reason. */
export const dropSchema = z.object({ reason: dropReasonSchema.optional() });
export type Drop = z.infer<typeof dropSchema>;

/**
 * POST /tasks/:id/start-over, Start over a Task the user paused or stopped: it goes to Ready, its
 * earlier Stage runs kept as history only; with `resetBranch`, its branch is reset to the freshly
 * fetched base, the old head kept under a local ref. Answers the Task.
 */
export const taskStartOverSchema = z.object({ resetBranch: z.boolean() });
export type TaskStartOver = z.infer<typeof taskStartOverSchema>;

/** Where Reopen… takes a Dropped Task. */
export const reopenToSchema = z.enum(["backlog", "ready"]);
export type ReopenTo = z.infer<typeof reopenToSchema>;

/**
 * POST /tasks/:id/reopen, Reopen… a Dropped Task to Backlog or Ready; one that had started is
 * started over, its branch reset to the base with `resetBranch`. Answers the Task.
 */
export const taskReopenSchema = z.object({ to: reopenToSchema, resetBranch: z.boolean() });
export type TaskReopen = z.infer<typeof taskReopenSchema>;

/** Whether one of a Task's ways back is offered now, and the reason when it isn't. */
export const wayBackSchema = z.object({ offered: z.boolean(), why: z.string().nullable() });
export type WayBack = z.infer<typeof wayBackSchema>;

/**
 * GET /tasks/:id/ways-back: Restart from… and Start over, for a Task Paused by the user's Pause or
 * Stop, and Reopen… to Backlog or to Ready, for a Dropped Task, each offered or why not, as the
 * Task page offers them; with whether the Task had started, so Start over and Reopen… ask about
 * resetting its branch, and the branch a reset takes it to.
 */
export const taskWaysBackSchema = z.object({
  restart: wayBackSchema,
  startOver: wayBackSchema,
  reopen: wayBackSchema,
  reopenToReady: wayBackSchema,
  started: z.boolean(),
  /** The branch a reset takes the Task's branch to: its Initiative's branch, else the base branch. */
  resetTo: z.string(),
});
export type TaskWaysBack = z.infer<typeof taskWaysBackSchema>;

/** PUT /tasks/:id/tags: the Task's Tags as they should be. */
export const tagsChangeSchema = z.object({ tags: z.array(z.string()) });
export type TagsChange = z.infer<typeof tagsChangeSchema>;

/**
 * PUT /tasks/:id/plan: the user's Plan, confirmed. Confirming the proposed one sends it as shown,
 * so what is confirmed is what the user read; an edit sends the edited words. Its files to change
 * and token estimate go with it; each left out, the Task keeps its own.
 */
export const planChangeSchema = z.object({
  plan: z.string(),
  filesToChange: z.array(z.string()).optional(),
  estimatedTokens: estimatedTokensSchema.optional(),
});
export type PlanChange = z.infer<typeof planChangeSchema>;

/** PUT /tasks/:id/definition-of-done: the user's Definition of Done, confirmed, as with the Plan. */
export const definitionOfDoneChangeSchema = z.object({ definitionOfDone: z.array(z.string()) });
export type DefinitionOfDoneChange = z.infer<typeof definitionOfDoneChangeSchema>;

/**
 * PUT /tasks/:id/pipeline: the Pipeline the user sets for the Task, by id: the proposed one to
 * confirm it, or another from the library. Either ends the proposal.
 */
export const pipelineChangeSchema = z.object({ pipelineId: z.string() });
export type PipelineChange = z.infer<typeof pipelineChangeSchema>;

/**
 * POST /tasks/:id/ready: Mark Ready. `confirmPlanAndDefinitionOfDone`, once the user agreed to go on
 * without them, confirms the Plan and the Definition of Done as they stand, even empty, in the same
 * change; the Pipeline and Decision conditions still hold.
 */
export const markReadyRequestSchema = z.object({
  confirmPlanAndDefinitionOfDone: z.boolean().default(false),
});
export type MarkReadyRequest = z.input<typeof markReadyRequestSchema>;

/**
 * The query of GET /tasks/:id/move: the Project it would move to, which adds why its Initiative's
 * Pipeline can't run there; every Project when left out.
 */
export const taskMoveCheckQuerySchema = z.object({ projectId: z.string().min(1).optional() });
export type TaskMoveCheckQuery = z.infer<typeof taskMoveCheckQuerySchema>;

/** POST /tasks/:id/move: the Project the Task moves to. */
export const taskMoveSchema = z.object({ projectId: z.string().min(1) });
export type TaskMove = z.infer<typeof taskMoveSchema>;

/** GET /tasks/:id/move: every reason the Task can't move to another Project; empty when it can. */
export const taskMoveCheckSchema = z.object({ problems: z.array(z.string()) });
export type TaskMoveCheck = z.infer<typeof taskMoveCheckSchema>;

/**
 * PUT /tasks/:id/place: the Tasks it lands between in its column of the board, null at either
 * end. It takes the priority that keeps it there.
 */
export const taskPlacementSchema = z.object({
  above: z.uuid().nullable(),
  below: z.uuid().nullable(),
});
export type TaskPlacement = z.infer<typeof taskPlacementSchema>;

const taskIdInput = z.uuid().describe("The id of the Task.");
const ideaIdInput = z.uuid().describe("The id of the Idea.");
const initiativeIdInput = z.uuid().describe("The id of the Initiative.");

/** Office action: the Task waits for another to be Done before it can start. */
export const ADD_DEPENDENCY_ACTION = officeAction({
  name: "add_dependency",
  title: "Make a Task wait for another",
  description:
    "Makes a Task wait for another Task to be Done before it can start: any Task, in any Project or Initiative. Refused once the Task has started, for a Task that is dropped or archived, for the Task itself, and for a wait that would close a cycle. A Task waits directly only for Tasks it doesn't already wait for through another Task: when it already does, nothing is added and the answer says through which Task; otherwise the direct waits the new one covers, on this Task and on the Tasks not started that wait for it, are taken out, and the answer names each one.",
  input: z.object({
    taskId: z.uuid().describe("The id of the Task that must wait."),
    blockerId: z.uuid().describe("The id of the Task that must be Done first."),
  }),
  answer: taskSchema,
  route: { method: "POST", path: "/tasks/:taskId/dependencies" },
  area: "initiatives",
  group: "initiativeRecords",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: the Task no longer waits for one it waits for. */
export const REMOVE_DEPENDENCY_ACTION = officeAction({
  name: "remove_dependency",
  title: "Stop a Task waiting for another",
  description:
    "Lets a Task stop waiting for a Task it waits for, before it starts; its other dependencies stay.",
  input: z.object({
    taskId: z.uuid().describe("The id of the Task that waits."),
    blockerId: z.uuid().describe("The id of the Task it waits for."),
  }),
  answer: taskSchema,
  route: { method: "DELETE", path: "/tasks/:taskId/dependencies/:blockerId" },
  area: "initiatives",
  group: "initiativeRecords",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: an existing Task joins an Initiative. */
export const ADD_TO_INITIATIVE_ACTION = officeAction({
  name: "add_to_initiative",
  title: "Add a Task to an Initiative",
  description:
    "Adds an existing Task to an Initiative, straight away whether it is being shaped or active. A Task is in at most one Initiative and joins before it starts; one The Office made (an Onboard, a run environment set-up or a Publishing Task) never joins; only a Task in Backlog joins an Initiative being shaped, and moves to Shaping with it; a done or dropped Initiative takes none.",
  input: z.object({
    initiativeId: z.uuid().describe("The id of the Initiative, being shaped or active."),
    taskId: z.uuid().describe("The id of the Task to add, in no Initiative."),
  }),
  answer: taskSchema,
  route: { method: "PUT", path: "/initiatives/:initiativeId/tasks/:taskId" },
  area: "initiatives",
  group: "initiativeRecords",
  subject: ({ initiativeId }) => ({ kind: "initiative", id: initiativeId }),
});

/** Office action: the Task leaves its Initiative. */
export const TAKE_OUT_OF_INITIATIVE_ACTION = officeAction({
  name: "take_out_of_initiative",
  title: "Take a Task out of an Initiative",
  description:
    "Takes a Task out of its Initiative, straight away whether it is being shaped or active, before the Task starts; never a Publishing Task. A Task in Shaping goes to Backlog, and one planned in the Initiative's planning Thread loses it: from Planning it goes to Backlog, and a Ready one stays Ready. The Initiative's Publishing Task stops waiting for it; its other dependencies stay.",
  input: z.object({
    initiativeId: z.uuid().describe("The id of the Initiative the Task is in."),
    taskId: z.uuid().describe("The id of the Task to take out."),
  }),
  answer: taskSchema,
  route: { method: "DELETE", path: "/initiatives/:initiativeId/tasks/:taskId" },
  area: "initiatives",
  group: "initiativeRecords",
  subject: ({ initiativeId }) => ({ kind: "initiative", id: initiativeId }),
});

/** Office action: a new Task in an Initiative. */
export const ADD_TASK_ACTION = officeAction({
  name: "add_task",
  title: "Add a Task to an Initiative",
  description:
    "Adds a new Task to an Initiative in your name, in one Project, on no Pipeline until one is chosen, waiting from the start for the Tasks it names: in Shaping until the Initiative is confirmed, in Backlog from then on; planning it comes after. On an active Initiative it is drafted as a Proposal in this Thread, which adds the Task only when the user applies it.",
  input: z.object({
    initiativeId: initiativeIdInput,
    title: z.string().describe("One line naming the outcome of this Task."),
    projectId: z.string().describe("The Project's id, as list_projects gives it."),
    description: z
      .string()
      .default("")
      .describe("What the Task is for, in plain language; none when the title says it all."),
    priority: prioritySchema.default("normal").describe("Normal unless the user says otherwise."),
    kind: taskKindSchema.default("feature").describe("Feature, Bug or Chore."),
    tags: z
      .array(z.string())
      .default([])
      .describe("Free-form words to find it by; none unless asked."),
    blockedBy: z
      .array(z.uuid())
      .default([])
      .describe(
        "The ids of the Tasks that must be Done before this one can start, in any Project or Initiative; none unless it must wait. It waits directly only for those no other of them already waits for.",
      ),
  }),
  answer: taskSchema,
  route: { method: "POST", path: "/initiatives/:initiativeId/tasks" },
  status: 201,
  area: "initiatives",
  group: "initiativeRecords",
  subject: ({ initiativeId }) => ({ kind: "initiative", id: initiativeId }),
});

/** Office action: the Initiative's Pipeline in one Project it spans. */
export const CHOOSE_PIPELINE_ACTION = officeAction({
  name: "choose_pipeline",
  title: "Choose an Initiative's Pipeline",
  description:
    "Chooses an Initiative's Pipeline in one Project it spans, from the office-wide Pipelines and that Project's own Project Pipelines, or None with null. Each Project has its own: with one, the Project's Tasks publish into the Initiative's branch there, initiative/<Short name>, and its Publishing Task publishes the whole change through that Pipeline; with None, each of its Tasks publishes on its own. The Short name comes from the Initiative's title once any Project has a Pipeline; only the user edits it. Whether each Project has a Pipeline is fixed at Confirm; once the Initiative is active only another Pipeline can be chosen for a Project that has one, or a first one for a Project it came to span since, and your call is drafted as a Proposal in this Thread, which changes it only when the user applies it. Refused for another Project's Project Pipeline, and when the Project lacks a command the Pipeline runs.",
  input: z.object({
    initiativeId: initiativeIdInput,
    projectId: z.string().describe("The id of a Project this Initiative spans."),
    pipelineId: z
      .string()
      .nullable()
      .describe(
        "An office-wide Pipeline's id or one of that Project's Project Pipelines, as the Brief lists them; null for None.",
      ),
  }),
  answer: initiativeSchema,
  route: { method: "PUT", path: "/initiatives/:initiativeId/pipeline" },
  area: "initiatives",
  group: "initiativeRecords",
  subject: ({ initiativeId }) => ({ kind: "initiative", id: initiativeId }),
});

/** Office action: the Task's title. */
export const CHANGE_TASK_TITLE_ACTION = officeAction({
  name: "change_task_title",
  title: "Change a Task's title",
  description:
    "Changes a Task's title, in any state but Done and Dropped. For a Task of an active Initiative your call is drafted as a Proposal in this Thread, which changes it only when the user applies it. The change is kept in the Task's History, with who made it.",
  input: z.object({ taskId: taskIdInput, title: z.string().describe("The new title.") }),
  answer: taskSchema,
  route: { method: "PUT", path: "/tasks/:taskId/title" },
  area: "work",
  group: "taskRecords",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: the Task's Description. */
export const CHANGE_TASK_DESCRIPTION_ACTION = officeAction({
  name: "change_task_description",
  title: "Change a Task's Description",
  description:
    "Replaces a Task's Description, in Markdown, until the Task starts; empty leaves it none. The user may have written it, so read the Task with read_task first and keep what they said. For a Task of an active Initiative your call is drafted as a Proposal in this Thread, which changes it only when the user applies it. The change is kept in the Task's History, with who made it.",
  input: z.object({
    taskId: taskIdInput,
    description: z.string().describe("The whole new Description, in Markdown."),
  }),
  answer: taskSchema,
  route: { method: "PUT", path: "/tasks/:taskId/description" },
  area: "work",
  group: "taskRecords",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: the Task's Kind. */
export const CHANGE_TASK_KIND_ACTION = officeAction({
  name: "change_task_kind",
  title: "Change a Task's kind",
  description:
    "Changes a Task's Kind (Feature, Bug or Chore), in any state but Done and Dropped; the Task never moves for it. The change is kept in the Task's History, with who made it.",
  input: z.object({ taskId: taskIdInput, kind: taskKindSchema.describe("The new Kind.") }),
  answer: taskSchema,
  route: { method: "PUT", path: "/tasks/:taskId/kind" },
  area: "work",
  group: "taskRecords",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: the Task's priority. */
export const CHANGE_TASK_PRIORITY_ACTION = officeAction({
  name: "change_task_priority",
  title: "Change a Task's priority",
  description:
    "Changes a Task's priority (high, normal or low), which orders the board and the queue. The change is kept in the Task's History, with who made it.",
  input: z.object({
    taskId: taskIdInput,
    priority: prioritySchema.describe("The new priority."),
  }),
  answer: taskSchema,
  route: { method: "PUT", path: "/tasks/:taskId/priority" },
  area: "work",
  group: "taskRecords",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: the Task's Plan, saved as the user's Save does. */
export const CHANGE_TASK_PLAN_ACTION = officeAction({
  name: "change_task_plan",
  title: "Change a Task's Plan",
  description:
    "Replaces a Task's Plan, in Markdown, with its files to change, until the Task starts, as the user's Save on the Plan does: a changed Plan is Not confirmed until the user confirms it, and a Ready Task goes back to Planning, or to Backlog when it never had a planning Thread. The change is kept in the Task's History, with who made it.",
  input: z.object({
    taskId: taskIdInput,
    plan: z.string().describe("The whole new Plan, in Markdown."),
    filesToChange: z
      .array(z.string())
      .optional()
      .describe("The files the Plan expects to change, by their paths in the repository."),
    estimatedTokens: estimatedTokensSchema
      .optional()
      .describe(
        "How many tokens the whole Pipeline is expected to use; kept as it is when left out.",
      ),
  }),
  answer: taskSchema,
  route: { method: "PUT", path: "/tasks/:taskId/plan" },
  area: "work",
  group: "taskRecords",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: the Task's Definition of Done, saved as the user's Save does. */
export const CHANGE_TASK_DEFINITION_OF_DONE_ACTION = officeAction({
  name: "change_task_definition_of_done",
  title: "Change a Task's Definition of Done",
  description:
    "Replaces a Task's Definition of Done, one statement per item, until the Task starts, as the user's Save does: a changed one is Not confirmed until the user confirms it, and a Ready Task goes back to Planning, or to Backlog when it never had a planning Thread. The change is kept in the Task's History, with who made it.",
  input: z.object({
    taskId: taskIdInput,
    definitionOfDone: z
      .array(z.string())
      .describe("Every statement of the new Definition of Done, in order."),
  }),
  answer: taskSchema,
  route: { method: "PUT", path: "/tasks/:taskId/definition-of-done" },
  area: "work",
  group: "taskRecords",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: Drop the Task, with the reason given, if any. */
export const DROP_TASK_ACTION = officeAction({
  name: "drop_task",
  title: "Drop a Task",
  description:
    "Drops a Task, with an optional Drop reason: won't fix, can't reproduce, or a duplicate of another Task, named by its id. A Dropped Task leaves the work but stays on the board until it is archived. You may Drop only a Task that hasn't started; one that has is the user's to Drop.",
  input: z.object({
    taskId: taskIdInput,
    reason: dropReasonSchema.optional().describe("Why it is dropped; none when left out."),
  }),
  answer: taskSchema,
  route: { method: "POST", path: "/tasks/:taskId/drop" },
  area: "work",
  group: "taskRecords",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: a Done or Dropped Task leaves the board for the Archive. */
export const ARCHIVE_TASK_ACTION = officeAction({
  name: "archive_task",
  title: "Archive a Task",
  description:
    "Archives a Done or Dropped Task: it leaves the board for the Archive, its state as it was.",
  input: z.object({ taskId: taskIdInput }),
  answer: taskSchema,
  route: { method: "POST", path: "/tasks/:taskId/archive" },
  area: "work",
  group: "taskRecords",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: an archived Task returns to the board. */
export const RESTORE_TASK_ACTION = officeAction({
  name: "restore_task",
  title: "Restore a Task",
  description: "Restores an archived Task: it returns to the board in the state it had.",
  input: z.object({ taskId: taskIdInput }),
  answer: taskSchema,
  route: { method: "POST", path: "/tasks/:taskId/restore" },
  area: "work",
  group: "taskRecords",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: the Idea's title, notes and Project. */
export const EDIT_IDEA_ACTION = officeAction({
  name: "edit_idea",
  title: "Edit an Idea",
  description:
    "Edits an Idea's title, notes and Project, all three given whole, until it is shaped. The change is kept in the Idea's History, with who made it.",
  input: z.object({
    ideaId: ideaIdInput,
    title: z.string().describe("The Idea's title."),
    notes: z.string().describe("The Idea's notes, in Markdown; empty for none."),
    projectId: z
      .string()
      .nullable()
      .describe("The id of the Project it is about; null for an Office-wide Idea."),
  }),
  answer: ideaSchema,
  route: { method: "PUT", path: "/ideas/:ideaId" },
  area: "ideas",
  group: "ideas",
  subject: ({ ideaId }) => ({ kind: "idea", id: ideaId }),
});

/** Office action: Drop the Idea. */
export const DROP_IDEA_ACTION = officeAction({
  name: "drop_idea",
  title: "Drop an Idea",
  description: "Drops an Idea that isn't shaped yet; Restore brings it back.",
  input: z.object({ ideaId: ideaIdInput }),
  answer: ideaSchema,
  route: { method: "POST", path: "/ideas/:ideaId/drop" },
  area: "ideas",
  group: "ideas",
  subject: ({ ideaId }) => ({ kind: "idea", id: ideaId }),
});

/** Office action: a Dropped Idea is new again. */
export const RESTORE_IDEA_ACTION = officeAction({
  name: "restore_idea",
  title: "Restore an Idea",
  description: "Restores a Dropped Idea: it is new again.",
  input: z.object({ ideaId: ideaIdInput }),
  answer: ideaSchema,
  route: { method: "POST", path: "/ideas/:ideaId/restore" },
  area: "ideas",
  group: "ideas",
  subject: ({ ideaId }) => ({ kind: "idea", id: ideaId }),
});

/** Office action: the Initiative's outcome. */
export const WRITE_INITIATIVE_OUTCOME_ACTION = officeAction({
  name: "write_initiative_outcome",
  title: "Write an Initiative's outcome",
  description:
    "Replaces an Initiative's outcome: what must be true once it is done, in plain language the user agreed to. While the Initiative is being shaped it shows on the Initiative's page at once; once it is active your call is drafted as a Proposal in this Thread, which changes it only when the user applies it. The change is kept in the Initiative's History, with who made it.",
  input: z.object({
    initiativeId: initiativeIdInput,
    outcome: z.string().describe("The whole new outcome, in Markdown."),
  }),
  answer: initiativeSchema,
  route: { method: "PUT", path: "/initiatives/:initiativeId/outcome" },
  area: "initiatives",
  group: "initiativeRecords",
  subject: ({ initiativeId }) => ({ kind: "initiative", id: initiativeId }),
});

/** Office action: Drop the Initiative; its Tasks stay as they are. */
export const DROP_INITIATIVE_ACTION = officeAction({
  name: "drop_initiative",
  title: "Drop an Initiative",
  description:
    "Drops an Initiative being shaped or active; its Tasks and branches stay as they are. You may Drop only an Initiative none of whose Tasks has started; one with a started Task is the user's to Drop.",
  input: z.object({ initiativeId: initiativeIdInput }),
  answer: initiativeSchema,
  route: { method: "POST", path: "/initiatives/:initiativeId/drop" },
  area: "initiatives",
  group: "initiativeRecords",
  subject: ({ initiativeId }) => ({ kind: "initiative", id: initiativeId }),
});

/** Office action: a Done or Dropped Initiative leaves the board for the Archive. */
export const ARCHIVE_INITIATIVE_ACTION = officeAction({
  name: "archive_initiative",
  title: "Archive an Initiative",
  description:
    "Archives a Done or Dropped Initiative: it leaves the board for the Archive, its state as it was.",
  input: z.object({ initiativeId: initiativeIdInput }),
  answer: initiativeSchema,
  route: { method: "POST", path: "/initiatives/:initiativeId/archive" },
  area: "initiatives",
  group: "initiativeRecords",
  subject: ({ initiativeId }) => ({ kind: "initiative", id: initiativeId }),
});

/** Office action: an archived Initiative returns to the board. */
export const RESTORE_INITIATIVE_ACTION = officeAction({
  name: "restore_initiative",
  title: "Restore an Initiative",
  description:
    "Restores an archived Initiative: it returns to the board, in Done or Dropped as it was.",
  input: z.object({ initiativeId: initiativeIdInput }),
  answer: initiativeSchema,
  route: { method: "POST", path: "/initiatives/:initiativeId/restore" },
  area: "initiatives",
  group: "initiativeRecords",
  subject: ({ initiativeId }) => ({ kind: "initiative", id: initiativeId }),
});

/** Office action: Start over a Task the user paused or stopped. */
export const START_TASK_OVER_ACTION = officeAction({
  name: "start_task_over",
  title: "Start a Task over",
  description:
    "Starts a Task Paused by the user over: it goes to Ready, its earlier Stage runs kept as history only; with resetBranch, its branch is reset to the freshly fetched base.",
  input: z.object({
    taskId: taskIdInput,
    resetBranch: z.boolean().describe("Whether the Task's branch is reset to the base."),
  }),
  answer: taskSchema,
  route: { method: "POST", path: "/tasks/:taskId/start-over" },
  area: "work",
  group: "gatesAndRuns",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: Reopen a Dropped Task to Backlog or Ready. */
export const REOPEN_TASK_ACTION = officeAction({
  name: "reopen_task",
  title: "Reopen a Task",
  description:
    "Reopens a Dropped Task to Backlog or Ready, restoring it first when archived; one that had started is started over, with resetBranch resetting its branch to the base.",
  input: z.object({
    taskId: taskIdInput,
    to: reopenToSchema.describe("Where the Task goes: backlog or ready."),
    resetBranch: z.boolean().describe("Whether the Task's branch is reset to the base."),
  }),
  answer: taskSchema,
  route: { method: "POST", path: "/tasks/:taskId/reopen" },
  area: "work",
  group: "gatesAndRuns",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** A field of a Task, an Idea or an Initiative whose edits its History keeps. */
export const editedFieldSchema = z.enum([
  "title",
  "description",
  "kind",
  "priority",
  "plan",
  "definition-of-done",
  "notes",
  "project",
  "outcome",
]);
export type EditedField = z.infer<typeof editedFieldSchema>;

/**
 * One line of a record's History, oldest first: a Task's move between states (`from` null for its
 * creation), or an edit of one field, which keeps no old or new value. `by` is who or what made it,
 * as the record words it after "by": "the user Ann Lee", "the person in the Role planner".
 */
export const historyEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("state-change"),
    at: z.iso.datetime(),
    from: taskStateSchema.nullable(),
    to: taskStateSchema,
    by: z.string(),
  }),
  z.object({
    kind: z.literal("edit"),
    at: z.iso.datetime(),
    field: editedFieldSchema,
    by: z.string(),
  }),
]);
export type HistoryEntry = z.infer<typeof historyEntrySchema>;

/** GET /tasks/:id/history, /ideas/:id/history and /initiatives/:id/history. */
export const historySchema = z.array(historyEntrySchema);
export type History = z.infer<typeof historySchema>;

/** A started Task in the same Project whose Plan expects to change some of the same files. */
export const overlapSchema = z.object({
  taskId: z.uuid(),
  title: z.string(),
});
export type Overlap = z.infer<typeof overlapSchema>;

/**
 * The measures a Usage estimate is given in, as Settings › Office limits ticks them: tokens (input,
 * output and cache writes), the 5-hour and the 7-day window in percentage points, cost in dollars.
 */
export const usageMeasureSchema = z.enum(["tokens", "fiveHourWindow", "sevenDayWindow", "cost"]);
export type UsageMeasure = z.infer<typeof usageMeasureSchema>;

/**
 * What a Task's whole Pipeline is expected to use on one engine its Stages' Roles run on, in the
 * ticked measures alone; the windows only on an engine whose account has them (a Claude Code
 * engine, or a Codex engine on a ChatGPT plan). A ticked window or cost is null when there is no
 * estimate of it: no reading to learn from, or ("no cost") a model with no Model price.
 */
export const engineUsageEstimateSchema = z.object({
  engineId: engineIdSchema,
  tokens: z.number().int().nonnegative().optional(),
  fiveHourWindow: z.number().nonnegative().nullable().optional(),
  sevenDayWindow: z.number().nonnegative().nullable().optional(),
  cost: z.number().nonnegative().nullable().optional(),
});
export type EngineUsageEstimate = z.infer<typeof engineUsageEstimateSchema>;

/**
 * Where a Usage estimate came from: the history of `tasks` done Tasks of the same Project and
 * Pipeline, the Planner's token estimate below 3 of them, or neither ("no estimate").
 */
export const usageEstimateBasisSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("history"), tasks: z.number().int().positive() }),
  z.object({ source: z.literal("planner") }),
  z.object({ source: z.literal("none") }),
]);
export type UsageEstimateBasis = z.infer<typeof usageEstimateBasisSchema>;

/** A Task's Usage estimate, per engine id; "no estimate" has no engines. */
export const usageEstimateSchema = z.object({
  basis: usageEstimateBasisSchema,
  engines: z.array(engineUsageEstimateSchema),
});
export type UsageEstimate = z.infer<typeof usageEstimateSchema>;

/** GET /usage-estimates: every Ready Task's Usage estimate, queued ones too; empty with no measure ticked. */
export const taskUsageEstimateListSchema = z.array(
  z.object({ taskId: z.uuid(), usageEstimate: usageEstimateSchema }),
);
export type TaskUsageEstimateList = z.infer<typeof taskUsageEstimateListSchema>;

/**
 * What starting a Task anyway past its usage caps does (a Window cap, a Daily cap, a used-up
 * window, no Stand-in Engine with room), offered while only those hold it: the caps it passes, short
 * and named by the engine, and the engines its Stages run on, the first of the cascade's and its
 * Stand-in Engines whose window isn't used up. `refusals` says why it can't, every such engine's
 * window used up; empty when it can.
 */
export const pastUsageCapsSchema = z.object({
  passes: z.array(z.string()),
  engines: z.array(z.object({ name: z.string(), standingInFor: z.string().nullable() })),
  refusals: z.array(z.string()),
});
export type PastUsageCaps = z.infer<typeof pastUsageCapsSchema>;

/**
 * What starting a Task now past the limits does, offered while the Office-wide limit or its Project
 * limit holds it: the limits it passes, short. `refusals` says why it can't, whatever else holds
 * the Task; empty when it can.
 */
export const pastLimitsSchema = z.object({
  passes: z.array(z.string()),
  refusals: z.array(z.string()),
});
export type PastLimits = z.infer<typeof pastLimitsSchema>;

/**
 * GET /tasks/:id/start: why the Task can't start now; all empty when it can. A refusal stops
 * Start; a wait (a blocker, the Office-wide limit, its person's Task limit) only holds the Task
 * until its blockers end and a desk and its person are free; an Overlap asks the user to start
 * anyway or to queue behind it.
 */
export const startCheckSchema = z.object({
  refusals: z.array(z.string()),
  waits: z.array(z.string()),
  /** The Tasks not yet Done or Dropped that it waits for: it can only queue, never start anyway. */
  blockers: z.array(z.object({ taskId: z.uuid(), title: z.string() })),
  overlaps: z.array(overlapSchema),
  /** What the Task is expected to use; null with no measure ticked. */
  usageEstimate: usageEstimateSchema.nullable(),
  /** Start anyway past the usage caps; null unless only its usage holds the Task. */
  pastUsageCaps: pastUsageCapsSchema.nullable(),
  /** Start now past the limits; null unless the Office-wide or the Project limit holds the Task. */
  pastLimits: pastLimitsSchema.nullable(),
});
export type StartCheck = z.infer<typeof startCheckSchema>;

/**
 * The user's answer to an Overlap at Start: "start-anyway", or "queue-behind" the Tasks it
 * overlaps until each is Done or Dropped.
 */
export const overlapChoiceSchema = z.enum(["start-anyway", "queue-behind"]);
export type OverlapChoice = z.infer<typeof overlapChoiceSchema>;

/** The user's word to start a Task anyway past its usage caps, never queueing it. */
export const usageCapsChoiceSchema = z.enum(["start-anyway"]);
export type UsageCapsChoice = z.infer<typeof usageCapsChoiceSchema>;

/** The user's word to start a Task now past the Office-wide and Project limits, never queueing it. */
export const limitsChoiceSchema = z.enum(["start-anyway"]);
export type LimitsChoice = z.infer<typeof limitsChoiceSchema>;

/**
 * POST /tasks/:id/start: the answer to an Overlap; while one stands, Start without it refuses. No
 * body is no answer. `onUsageCaps` starts it anyway past its usage caps, `onLimits` past the
 * Office-wide and Project limits, or refuses with whatever still holds it.
 */
export const startRequestFieldsSchema = z.object({
  onOverlap: overlapChoiceSchema.optional(),
  onUsageCaps: usageCapsChoiceSchema.optional(),
  onLimits: limitsChoiceSchema.optional(),
});
export const startRequestSchema = startRequestFieldsSchema.default({});
export type StartRequest = z.infer<typeof startRequestSchema>;

/** A Task in the one Office-wide queue for Start, with the waits that hold it. */
export const queuedTaskSchema = z.object({
  taskId: z.uuid(),
  /** 1 for the Task first in the queue. */
  place: z.number().int().positive(),
  queuedAt: z.iso.datetime(),
  reasons: z.array(z.string()),
  /**
   * The board card's short form of `reasons`, one per reason in the same order; empty for a Task
   * queued before short reasons until the queue's next release.
   */
  shortReasons: z.array(z.string()),
  /** The Tasks it was queued behind for an Overlap, each until it is Done or Dropped. */
  behind: z.array(z.uuid()),
});
export type QueuedTask = z.infer<typeof queuedTaskSchema>;

/**
 * GET /queue: every queued Task, first place first. DELETE /queue/:taskId takes one out;
 * POST /queue/:taskId/move-up moves it one place up; POST /queue/:taskId/move-to-top moves it to
 * the first place.
 */
export const queueSchema = z.array(queuedTaskSchema);

/**
 * POST /tasks/:id/start: the Task, In progress, or still Ready with its place in the queue when
 * only waits held it.
 */
export const startAnswerSchema = z.object({
  task: taskSchema,
  queued: queuedTaskSchema.nullable(),
});
export type StartAnswer = z.infer<typeof startAnswerSchema>;

/**
 * POST /tasks/:id/resolve-conflicts, Resolve conflicts on the Task's pull request: the Conflict
 * resolution Task, made now and started or queued, or the one already open. `startRefusal` holds
 * every reason Start refused it, which leaves it Ready; null when it started or queued.
 */
export const conflictResolutionAnswerSchema = z.object({
  task: taskSchema,
  queued: queuedTaskSchema.nullable(),
  startRefusal: z.array(z.string()).nullable(),
});
export type ConflictResolutionAnswer = z.infer<typeof conflictResolutionAnswerSchema>;

/**
 * Where an Off-board Task stands, as the Project page's card draws it. `failed` is a Stage out of
 * tries with its Decision open: `withCto` while the holder of "Asked first when a Stage runs out of
 * tries" has it, so the user can't Retry yet. `ready` is one made before Off-board Tasks started
 * at once, which waits for Start.
 */
export const offBoardTaskStatusSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("queued"),
    place: z.number().int().positive(),
    shortReasons: z.array(z.string()),
    queuedAt: z.iso.datetime(),
  }),
  z.object({ state: z.literal("running") }),
  z.object({
    state: z.literal("waiting-on-you"),
    /** The open Decision's id and its first question; null when none is found. */
    decisionId: z.uuid().nullable(),
    question: z.string().nullable(),
  }),
  z.object({ state: z.literal("paused") }),
  z.object({
    state: z.literal("failed"),
    stageName: z.string(),
    /** The failure's error, as the out-of-tries Decision gives it; null when it gave none. */
    error: z.string().nullable(),
    decisionId: z.uuid(),
    withCto: z.boolean(),
  }),
  z.object({ state: z.literal("ready") }),
  z.object({ state: z.literal("done"), endedAt: z.iso.datetime().nullable() }),
  z.object({
    state: z.literal("dropped"),
    endedAt: z.iso.datetime().nullable(),
    dropReason: z.string().nullable(),
  }),
]);
export type OffBoardTaskStatus = z.infer<typeof offBoardTaskStatusSchema>;
export type OffBoardTaskState = OffBoardTaskStatus["state"];

/** An Off-board Task, as the Project page, Activity and Needs you show it. */
export const offBoardTaskSchema = z.object({
  taskId: z.uuid(),
  projectId: z.string(),
  title: z.string(),
  kind: offBoardTaskKindSchema,
  status: offBoardTaskStatusSchema,
  /** Its Pipeline's Stage names in order, and the one it is at; null before it started. */
  stages: z.array(z.string()),
  currentStage: z.string().nullable(),
  /** Who works its current Stage; null while none does. */
  person: z.object({ roleKey: z.string(), name: z.string() }).nullable(),
  /** The current Stage run's Thread, to follow it; null while no Stage runs. */
  threadId: z.uuid().nullable(),
  /** When it entered its state. */
  since: z.iso.datetime(),
  /** Every Stage run's tokens so far (input, output and cache writes, as Today's tokens counts). */
  tokens: z.number().int().nonnegative(),
});
export type OffBoardTask = z.infer<typeof offBoardTaskSchema>;

/**
 * GET /projects/:id/off-board-tasks: the latest Off-board Task of each kind, null for a kind it
 * never had, and the earlier Onboard Tasks, newest first.
 */
export const projectOffBoardTasksSchema = z.object({
  onboard: offBoardTaskSchema.nullable(),
  onboardHistory: z.array(offBoardTaskSchema),
  runEnvironmentSetUp: offBoardTaskSchema.nullable(),
});
export type ProjectOffBoardTasks = z.infer<typeof projectOffBoardTasksSchema>;

/**
 * What starting an Off-board Task answers (POST /projects/:id/onboard, and the run environment's
 * set-up): started or queued, or the one already in flight; or refused, which makes nothing, with
 * every reason.
 */
export const offBoardTaskStartSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("started"), offBoardTask: offBoardTaskSchema }),
  z.object({ outcome: z.literal("in-flight"), offBoardTask: offBoardTaskSchema }),
  z.object({ outcome: z.literal("refused"), reasons: z.array(z.string()).min(1) }),
]);
export type OffBoardTaskStart = z.infer<typeof offBoardTaskStartSchema>;

/**
 * POST /initiatives/:id/start, Start Ready Tasks: what the normal Start did to each of the
 * Initiative's Ready Tasks, an Overlap answered with "queue behind". Queued ones carry their place
 * in the queue after the run and the waits that hold them; refused ones every reason.
 */
export const readyTasksStartedSchema = z.object({
  started: z.array(z.object({ taskId: z.uuid(), title: z.string() })),
  queued: z.array(
    z.object({
      taskId: z.uuid(),
      title: z.string(),
      place: z.number().int().positive(),
      reasons: z.array(z.string()),
    }),
  ),
  refused: z.array(z.object({ taskId: z.uuid(), title: z.string(), reasons: z.array(z.string()) })),
});
export type ReadyTasksStarted = z.infer<typeof readyTasksStartedSchema>;

/**
 * POST /initiatives/:id/pause and /resume, Pause and Resume the Initiative: the Initiative, and
 * the Tasks it paused, or resumed (held by the fire alarm instead while it is on).
 */
export const initiativePauseAnswerSchema = z.object({
  initiative: initiativeSchema,
  taskIds: z.array(z.uuid()),
});
export type InitiativePauseAnswer = z.infer<typeof initiativePauseAnswerSchema>;

/**
 * GET /tasks/:id/readiness: the "Before Ready" checklist, each condition of Mark Ready with the
 * reasons it isn't met yet, built from the same rules that refuse Mark Ready.
 */
export const readinessSchema = z.object({
  lines: z.array(
    z.object({
      /** What the line is about, so the page can offer what settles it. */
      part: z.enum(["plan", "definition-of-done", "pipeline", "decisions"]),
      label: z.string(),
      met: z.boolean(),
      problems: z.array(z.string()),
    }),
  ),
});
export type Readiness = z.infer<typeof readinessSchema>;

export const attachmentOwnerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("idea"), ideaId: z.uuid() }),
  z.object({ kind: z.literal("initiative"), initiativeId: z.uuid() }),
  z.object({ kind: z.literal("task"), taskId: z.uuid() }),
  /** An image the user sent in a message of a Thread on no Task or Initiative, such as a chat. */
  z.object({ kind: z.literal("thread"), threadId: z.uuid() }),
]);
export type AttachmentOwner = z.infer<typeof attachmentOwnerSchema>;

/** POST /{ideas,initiatives,tasks}/:id/attachments/links; an empty name is the URL. */
export const newLinkSchema = z.object({ name: z.string(), url: z.string() });
export type NewLink = z.infer<typeof newLinkSchema>;

/**
 * The query of POST /{ideas,initiatives,tasks}/:id/attachments/files, whose body is the file
 * itself as `application/octet-stream`.
 */
export const attachmentUploadQuerySchema = z.object({
  fileName: z.string().min(1),
  mediaType: z.string(),
});
export type AttachmentUploadQuery = z.infer<typeof attachmentUploadQuerySchema>;

const attachmentFields = {
  id: z.uuid(),
  owner: attachmentOwnerSchema,
  name: z.string(),
  addedBy: authorSchema,
  addedAt: z.iso.datetime(),
};

/** A link opens at its URL; a file at GET /attachments/:id/content. */
export const attachmentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("link"), ...attachmentFields, url: z.string() }),
  z.object({
    /** A document is Markdown; an image is shown as a picture. */
    kind: z.enum(["document", "image", "file"]),
    ...attachmentFields,
    mediaType: z.string(),
    /** In bytes. */
    size: z.int().nonnegative(),
    /** Whether it is a text file, a document always; an image or a PDF never is (spec §2.1). */
    text: z.boolean(),
  }),
]);
export type Attachment = z.infer<typeof attachmentSchema>;

/**
 * Whether a text file Attachment opens in the document window as plain text: not a document,
 * which renders as Markdown, nor an HTML file, which keeps its sandboxed preview (spec §4.1).
 */
export function isPlainTextFile(attachment: {
  readonly kind: Attachment["kind"];
  readonly mediaType?: string;
  readonly text?: boolean;
}): boolean {
  return attachment.kind === "file" && attachment.text === true && !isHtmlFile(attachment);
}

export const attachmentListSchema = z.array(attachmentSchema);

/**
 * Whether an Attachment is an HTML file, which opens in a sandboxed preview. A document's name makes
 * it Markdown whatever its media type, so only a `file` counts.
 */
export function isHtmlFile(attachment: {
  readonly kind: Attachment["kind"];
  readonly mediaType?: string;
}): boolean {
  const essence = attachment.mediaType?.split(";")[0]?.trim().toLowerCase();
  return attachment.kind === "file" && essence === "text/html";
}

/**
 * The query of GET /tasks and GET /search: words, each matched as the start of a word in a
 * record, all of them required. GET /tasks answers every Task when it has no words.
 */
export const searchQuerySchema = z.object({ query: z.string().default("") });
export type SearchQuery = z.infer<typeof searchQuerySchema>;

/**
 * The query of GET /tasks: the board's search words; or `archived=true` for the archived Tasks
 * instead of the board's, which takes no words.
 */
export const taskListQuerySchema = searchQuerySchema.extend({
  archived: z
    .enum(["true", "false"])
    .default("false")
    .transform((archived) => archived === "true"),
});
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;

/**
 * The query of GET /search: the words, and the Projects the Project filter shows as one `project`
 * each, every Project when none is named.
 */
export const searchEverythingQuerySchema = searchQuerySchema.extend({
  project: projectFilterParamSchema(),
});
export type SearchEverythingQuery = z.infer<typeof searchEverythingQuerySchema>;

/** The Projects a found record is in; none for one Office-wide. */
const foundFields = { id: z.uuid(), projectIds: z.array(z.string()) };

const countOfKind = z.number().int().nonnegative();

/**
 * GET /search: what the top bar's search found in the Projects the Project filter shows, by kind,
 * the best matches first; and how many more of each kind match in other Projects.
 */
export const searchResultsSchema = z.object({
  /** A Task in the Archive is found too, marked `archived`. */
  tasks: z.array(
    z.object({ ...foundFields, title: z.string(), state: taskStateSchema, archived: z.boolean() }),
  ),
  ideas: z.array(z.object({ ...foundFields, title: z.string(), state: ideaStateSchema })),
  initiatives: z.array(
    z.object({ ...foundFields, name: z.string(), state: initiativeStateSchema }),
  ),
  /** Document Attachments, in their owner's Projects. */
  attachments: z.array(
    z.object({ ...foundFields, name: z.string(), owner: attachmentOwnerSchema }),
  ),
  inOtherProjects: z.object({
    tasks: countOfKind,
    ideas: countOfKind,
    initiatives: countOfKind,
    attachments: countOfKind,
  }),
});
export type SearchResults = z.infer<typeof searchResultsSchema>;

/**
 * What narrows the Work board, each left out when not set. A Saved view holds them; the Project
 * filter is never one of them, as it follows the top bar.
 */
export const boardFiltersSchema = z.object({
  /** Matched as the search's words are (`searchQuerySchema`). */
  query: z.string().optional(),
  priority: prioritySchema.optional(),
  initiative: z.uuid().optional(),
  blocked: z.literal(true).optional(),
  /** Left out by Saved views saved before Kinds, which still parse. */
  kind: taskKindSchema.optional(),
});
export type BoardFilters = z.infer<typeof boardFiltersSchema>;

/** POST /saved-views: the board's filters, saved under a name. */
export const newSavedViewSchema = z.object({ name: z.string(), filters: boardFiltersSchema });
export type NewSavedView = z.infer<typeof newSavedViewSchema>;

export const savedViewSchema = newSavedViewSchema.extend({
  id: z.uuid(),
  savedAt: z.iso.datetime(),
});
export type SavedView = z.infer<typeof savedViewSchema>;

/** GET /saved-views: every Saved view, in the order saved. */
export const savedViewListSchema = z.array(savedViewSchema);

/** Settings › Office limits: the most desks the stepper offers (prototypes/app/settings.js). */
export const OFFICE_WIDE_LIMIT_MAX = 12;

/** How many Tasks may be started at once across The Office (spec §2.2). */
export const officeWideLimitSchema = z.object({
  officeWideLimit: z.int().min(1).max(OFFICE_WIDE_LIMIT_MAX),
});
export type OfficeWideLimit = z.infer<typeof officeWideLimitSchema>;

/** Settings › Office limits: the longest Archive period, in days. */
export const ARCHIVE_PERIOD_MAX = 365;

/**
 * The Archive period: how many days a Done or Dropped Task stays on the board once finished, or
 * once restored, before the daily run archives it (spec §2.1).
 */
export const archivePeriodSchema = z.object({
  archivePeriod: z.int().min(1).max(ARCHIVE_PERIOD_MAX),
});
export type ArchivePeriod = z.infer<typeof archivePeriodSchema>;

/**
 * GET /settings/auto-mode: whether Make a plan starts in auto mode, the user's last choice there,
 * off until first made.
 */
export const autoModeSettingSchema = z.object({ autoMode: z.boolean() });
export type AutoModeSetting = z.infer<typeof autoModeSettingSchema>;

/** A Window cap: the % of the window a Start may bring it to. */
export const windowCapSchema = z.int().min(1).max(100);

/**
 * The caps on one engine (spec §2.2), each null when off: a Window cap on each window, exactly on an
 * engine whose account has usage windows, a Claude Code engine or a Codex engine on a ChatGPT plan
 * (the service refuses windows elsewhere), and the Daily caps on tokens and on dollars.
 */
export const engineCapsSchema = z.object({
  engineId: engineIdSchema,
  windows: z
    .object({ fiveHour: windowCapSchema.nullable(), sevenDay: windowCapSchema.nullable() })
    .optional(),
  dailyTokens: z.int().positive().nullable(),
  dailyDollars: z.number().positive().nullable(),
});
export type EngineCaps = z.infer<typeof engineCapsSchema>;

/**
 * GET and PUT /settings/usage, Settings › Office limits: the ticked measures (none turns estimates
 * off) and the caps of every engine, each once: the service refuses caps that leave an engine out,
 * name one it doesn't list, or give Window caps to an engine without windows or none to one with.
 */
export const usageSettingsSchema = z.object({
  measures: z
    .array(usageMeasureSchema)
    .refine((measures) => new Set(measures).size === measures.length, {
      message: "Each measure is ticked once.",
    }),
  caps: z
    .array(engineCapsSchema)
    .refine((caps) => new Set(caps.map(({ engineId }) => engineId)).size === caps.length, {
      message: "Each engine has its caps once.",
    }),
});
export type UsageSettings = z.infer<typeof usageSettingsSchema>;

/**
 * How the fire alarm was sounded (spec §2.8), strictest first: Safe pause ASAP, after the current
 * Stages, or after the current Tasks.
 */
export const fireAlarmWaySchema = z.enum(["asap", "after-stages", "after-tasks"]);
export type FireAlarmWay = z.infer<typeof fireAlarmWaySchema>;

/**
 * GET /fire-alarm, and what POST /fire-alarm/sound answers (spec §2.8): off, or on since it was
 * sounded, the way it is on now.
 */
export const fireAlarmSchema = z.discriminatedUnion("on", [
  z.object({ on: z.literal(false) }),
  z.object({ on: z.literal(true), since: z.iso.datetime(), way: fireAlarmWaySchema }),
]);
export type FireAlarm = z.infer<typeof fireAlarmSchema>;

/**
 * POST /fire-alarm/sound: the way to sound it, ASAP when left out, as is a body left out. While it
 * is on, a stricter way makes it stricter; a softer one is refused with 422.
 */
export const soundFireAlarmSchema = z
  .object({ way: fireAlarmWaySchema.default("asap") })
  .prefault({});
export type SoundFireAlarm = z.input<typeof soundFireAlarmSchema>;

/** Office action: sound the fire alarm, or make it stricter (spec §2.8). */
export const SOUND_FIRE_ALARM_ACTION = officeAction({
  name: "sound_fire_alarm",
  title: "Sound the fire alarm",
  description:
    "Sounds the fire alarm one of its three ways, or makes it stricter while a softer way is on, and answers the alarm. ASAP stops every Stage, waiting Task, Consultation and background work at the next safe point and pauses every started Task; it takes the tools of every chat's Agent at once, this session's included, and the hard stop comes 60 s later. After the current Stages lets each running Stage run end and pauses its Task at the Stage boundary; after the current Tasks lets every started Task walk on to its end. Under every way nothing new starts. A softer way than the one on is refused. Only the user gives the all clear.",
  input: z.object({
    way: fireAlarmWaySchema
      .default("asap")
      .describe("How to stop: asap, after-stages or after-tasks; asap when left out."),
  }),
  answer: fireAlarmSchema,
  route: { method: "POST", path: "/fire-alarm/sound" },
  area: "operations",
  group: "fireAlarm",
  subject: () => ({ kind: "office-setting", id: "fire-alarm" }),
});

/**
 * POST /fire-alarm/all-clear, which answers the alarm, off: the Tasks the alarm paused that the
 * user holds or drops, by id; every other one it paused resumes.
 */
export const allClearSchema = z.object({
  hold: z.array(z.uuid()),
  drop: z.array(z.uuid()),
});
export type AllClear = z.infer<typeof allClearSchema>;

/** What a refused change answers: every reason, also joined into Nest's `message`. */
export const workRefusalSchema = z.object({
  statusCode: z.literal(422),
  message: z.string(),
  reasons: z.array(z.string()).min(1),
});
export type WorkRefusal = z.infer<typeof workRefusalSchema>;

/** Work's events the web receives; each names what changed, so its queries refresh. */
export const workWebEventSchema = z.discriminatedUnion("type", [
  webEventSchema.extend({ type: z.literal("idea.captured"), ideaId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("idea.edited"), ideaId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("idea.shaped"), ideaId: z.uuid(), taskId: z.uuid() }),
  webEventSchema.extend({
    type: z.literal("idea.shaped-into-initiative"),
    ideaId: z.uuid(),
    initiativeId: z.uuid(),
  }),
  webEventSchema.extend({ type: z.literal("idea.dropped"), ideaId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("idea.restored"), ideaId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("initiative.created"), initiativeId: z.uuid() }),
  webEventSchema.extend({
    type: z.literal("initiative.state-changed"),
    initiativeId: z.uuid(),
    from: initiativeStateSchema,
    to: initiativeStateSchema,
  }),
  webEventSchema.extend({ type: z.literal("initiative.outcome-written"), initiativeId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("initiative.pipeline-chosen"), initiativeId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("initiative.pipelines-set"), initiativeId: z.uuid() }),
  webEventSchema.extend({
    type: z.literal("initiative.engine-override-set"),
    initiativeId: z.uuid(),
  }),
  webEventSchema.extend({
    type: z.literal("initiative.short-name-written"),
    initiativeId: z.uuid(),
  }),
  webEventSchema.extend({
    type: z.literal("initiative.branch-made"),
    initiativeId: z.uuid(),
    projectId: z.string(),
  }),
  webEventSchema.extend({
    /** Deleted by hand or by Delete branches once merged (spec 5.5). */
    type: z.literal("initiative.branch-deleted"),
    initiativeId: z.uuid(),
    projectId: z.string(),
  }),
  webEventSchema.extend({ type: z.literal("task.branch-deleted"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("initiative.archived"), initiativeId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("initiative.restored"), initiativeId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("initiative.paused"), initiativeId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("initiative.resumed"), initiativeId: z.uuid() }),
  webEventSchema.extend({
    type: z.literal("initiative.planning-started"),
    initiativeId: z.uuid(),
    threadId: z.uuid(),
  }),
  webEventSchema.extend({ type: z.literal("task.created"), taskId: z.uuid() }),
  webEventSchema.extend({
    type: z.literal("task.state-changed"),
    taskId: z.uuid(),
    from: taskStateSchema,
    to: taskStateSchema,
  }),
  webEventSchema.extend({ type: z.literal("task.started"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.paused"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.stopped"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.resumed"), taskId: z.uuid() }),
  /**
   * A running Stage of the Task went on on a Stand-in Engine as its engine's usage window was used
   * up: the Task's Stand-in Engines changed.
   */
  webEventSchema.extend({ type: z.literal("task.went-on-on-stand-in"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.queued"), taskId: z.uuid() }),
  webEventSchema.extend({
    type: z.literal("task.left-queue"),
    taskId: z.uuid(),
    why: z.enum(["started", "taken-out", "left-ready", "refused"]),
    /** The reasons that refuse Start, when its turn met them. */
    refusals: z.array(z.string()),
  }),
  webEventSchema.extend({ type: z.literal("task.queue-reasons-changed"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.moved-up-in-queue"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.archived"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.restored"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.priority-changed"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.title-changed"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.kind-changed"), taskId: z.uuid() }),
  /** Its Caused by or Found in version changed (Found while working on is set only at creation). */
  webEventSchema.extend({ type: z.literal("task.bug-details-changed"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.description-changed"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.commit-message-changed"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.pull-request-end-changed"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.tags-changed"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.marked-planned"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.reordered"), taskId: z.uuid() }),
  webEventSchema.extend({
    type: z.literal("task.dependency-added"),
    taskId: z.uuid(),
    blockerId: z.uuid(),
  }),
  webEventSchema.extend({
    type: z.literal("task.dependency-removed"),
    taskId: z.uuid(),
    blockerId: z.uuid(),
  }),
  webEventSchema.extend({
    type: z.literal("task.added-to-initiative"),
    taskId: z.uuid(),
    initiativeId: z.uuid(),
  }),
  webEventSchema.extend({
    type: z.literal("task.taken-out-of-initiative"),
    taskId: z.uuid(),
    initiativeId: z.uuid(),
  }),
  webEventSchema.extend({
    type: z.literal("task.moved-to-project"),
    taskId: z.uuid(),
    fromProjectId: z.string(),
    toProjectId: z.string(),
  }),
  webEventSchema.extend({ type: z.literal("task.plan-proposed"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.plan-saved"), taskId: z.uuid() }),
  /** Its own engine override was set, or its Initiative's, which applies while it has none. */
  webEventSchema.extend({ type: z.literal("task.engine-override-set"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.plan-confirmed"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.definition-of-done-proposed"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.definition-of-done-saved"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.definition-of-done-confirmed"), taskId: z.uuid() }),
  webEventSchema.extend({
    type: z.literal("task.pipeline-proposed"),
    taskId: z.uuid(),
    pipelineId: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("task.pipeline-confirmed"),
    taskId: z.uuid(),
    pipelineId: z.string(),
  }),
  webEventSchema.extend({
    type: z.literal("attachment.added"),
    attachmentId: z.uuid(),
    owner: attachmentOwnerSchema,
  }),
  /** An Agent attached a new copy of the file in its place: same id, new bytes (spec §2.1). */
  webEventSchema.extend({
    type: z.literal("attachment.replaced"),
    attachmentId: z.uuid(),
    owner: attachmentOwnerSchema,
  }),
  webEventSchema.extend({
    type: z.literal("attachment.moved"),
    attachmentId: z.uuid(),
    from: attachmentOwnerSchema,
    to: attachmentOwnerSchema,
  }),
  webEventSchema.extend({
    type: z.literal("attachment.removed"),
    attachmentId: z.uuid(),
    owner: attachmentOwnerSchema,
  }),
  webEventSchema.extend({ type: z.literal("saved-view.saved"), savedViewId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("saved-view.removed"), savedViewId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("office-wide-limit.changed") }),
  webEventSchema.extend({ type: z.literal("archive-period.changed") }),
  /** The ticked measures or a cap changed: Settings › Office limits and the estimates read again. */
  webEventSchema.extend({ type: z.literal("usage-settings.changed") }),
  /** The fire alarm sounded, or the all clear was given: every tab reads it again, and its lifts. */
  webEventSchema.extend({ type: z.literal("fire-alarm.sounded") }),
  webEventSchema.extend({ type: z.literal("fire-alarm.all-clear") }),
]);
export type WorkWebEvent = z.infer<typeof workWebEventSchema>;

/** Office action: Shape the Idea into a Task. */
export const SHAPE_IDEA_INTO_TASK_ACTION = officeAction({
  name: "shape_idea_into_task",
  title: "Shape an Idea into a Task",
  description:
    "Shapes an Idea into a Task in Backlog in the Project given, of the Kind given (a Feature by default); the Idea is Shaped afterwards. A Description is for a Bug from an Idea without notes.",
  input: ideaShapingSchema.extend({ ideaId: ideaIdInput }),
  answer: taskSchema,
  route: { method: "POST", path: "/ideas/:ideaId/shape" },
  status: 201,
  area: "ideas",
  group: "ideas",
  subject: ({ ideaId }) => ({ kind: "idea", id: ideaId }),
});

/** Office action: Shape the Idea into an Initiative. */
export const SHAPE_IDEA_INTO_INITIATIVE_ACTION = officeAction({
  name: "shape_idea_into_initiative",
  title: "Shape an Idea into an Initiative",
  description:
    "Shapes an Idea into an Initiative, being shaped, with no Tasks yet; the Idea is Shaped afterwards.",
  input: z.object({ ideaId: ideaIdInput }),
  answer: initiativeSchema,
  route: { method: "POST", path: "/ideas/:ideaId/initiative" },
  status: 201,
  area: "ideas",
  group: "ideas",
  subject: ({ ideaId }) => ({ kind: "idea", id: ideaId }),
});

/** Office action: Plan the Idea as a Task with the Planner. */
export const PLAN_IDEA_AS_TASK_ACTION = officeAction({
  name: "plan_idea_as_task",
  title: "Plan an Idea as a Task",
  description:
    "Plans an Idea as a Task with the Planner: the Idea becomes a Task in Planning in the Project given, with its planning Thread open; the Idea is Shaped afterwards.",
  input: ideaShapingSchema.pick({ projectId: true }).extend({ ideaId: ideaIdInput }),
  answer: taskSchema,
  route: { method: "POST", path: "/ideas/:ideaId/plan" },
  status: 201,
  area: "ideas",
  group: "ideas",
  subject: ({ ideaId }) => ({ kind: "idea", id: ideaId }),
});

/** Office action: Confirm the Initiative. */
export const CONFIRM_INITIATIVE_ACTION = officeAction({
  name: "confirm_initiative",
  title: "Confirm an Initiative",
  description:
    "Confirms an Initiative being shaped: it becomes active, or Done at once when its Tasks already are, and its branch is made in each Project that has a Pipeline. Refused with every reason it can't be confirmed.",
  input: z.object({ initiativeId: initiativeIdInput }),
  answer: initiativeSchema,
  route: { method: "POST", path: "/initiatives/:initiativeId/confirm" },
  area: "initiatives",
  group: "runningAnInitiative",
  subject: ({ initiativeId }) => ({ kind: "initiative", id: initiativeId }),
});

/** Office action: Back to Shaping, the undo of Confirm. */
export const INITIATIVE_BACK_TO_SHAPING_ACTION = officeAction({
  name: "initiative_back_to_shaping",
  title: "Send an Initiative back to Shaping",
  description:
    "Takes a confirmed Initiative back to Shaping, undoing Confirm; refused with every reason it can't be, such as a Task that has started.",
  input: z.object({ initiativeId: initiativeIdInput }),
  answer: initiativeSchema,
  route: { method: "POST", path: "/initiatives/:initiativeId/back-to-shaping" },
  area: "initiatives",
  group: "runningAnInitiative",
  subject: ({ initiativeId }) => ({ kind: "initiative", id: initiativeId }),
});

/** Office action: Start Ready Tasks of the Initiative. */
export const START_READY_TASKS_ACTION = officeAction({
  name: "start_ready_tasks",
  title: "Start an Initiative's Ready Tasks",
  description:
    "Starts every Ready Task of an active Initiative as Start does, an Overlap queued behind; answers what started, what was queued and what was refused, each with its reasons.",
  input: z.object({ initiativeId: initiativeIdInput }),
  answer: readyTasksStartedSchema,
  route: { method: "POST", path: "/initiatives/:initiativeId/start" },
  area: "initiatives",
  group: "runningAnInitiative",
  subject: ({ initiativeId }) => ({ kind: "initiative", id: initiativeId }),
});

/** Office action: Pause the Initiative. */
export const PAUSE_INITIATIVE_ACTION = officeAction({
  name: "pause_initiative",
  title: "Pause an Initiative",
  description:
    "Pauses an active Initiative: its Tasks In progress or Waiting on you are paused, and every Start of its Tasks is held until it is resumed.",
  input: z.object({ initiativeId: initiativeIdInput }),
  answer: initiativePauseAnswerSchema,
  route: { method: "POST", path: "/initiatives/:initiativeId/pause" },
  area: "initiatives",
  group: "runningAnInitiative",
  subject: ({ initiativeId }) => ({ kind: "initiative", id: initiativeId }),
});

/** Office action: Resume the Initiative. */
export const RESUME_INITIATIVE_ACTION = officeAction({
  name: "resume_initiative",
  title: "Resume an Initiative",
  description:
    "Resumes a paused Initiative: the Tasks its Pause paused go on and its queued Tasks may start.",
  input: z.object({ initiativeId: initiativeIdInput }),
  answer: initiativePauseAnswerSchema,
  route: { method: "POST", path: "/initiatives/:initiativeId/resume" },
  area: "initiatives",
  group: "runningAnInitiative",
  subject: ({ initiativeId }) => ({ kind: "initiative", id: initiativeId }),
});

/** Office action: the Initiative's engine override. */
export const SET_INITIATIVE_ENGINE_ACTION = officeAction({
  name: "set_initiative_engine",
  title: "Set an Initiative's engine",
  description:
    "Sets an Initiative's engine override, null for none, while it is shaping or active. Refused for an engine not listed, and when a Role of an open Task's Pipeline couldn't run on it.",
  input: workEngineChangeSchema.extend({ initiativeId: initiativeIdInput }),
  answer: initiativeSchema,
  route: { method: "PUT", path: "/initiatives/:initiativeId/engine" },
  area: "initiatives",
  group: "initiativeRecords",
  subject: ({ initiativeId }) => ({ kind: "initiative", id: initiativeId }),
});

/** Office action: the Initiative's Short name. */
export const WRITE_INITIATIVE_SHORT_NAME_ACTION = officeAction({
  name: "write_initiative_short_name",
  title: "Write an Initiative's Short name",
  description:
    "Writes an Initiative's Short name, which its branches are named by, while it is being shaped.",
  input: shortNameChangeSchema.extend({ initiativeId: initiativeIdInput }),
  answer: initiativeSchema,
  route: { method: "PUT", path: "/initiatives/:initiativeId/short-name" },
  area: "initiatives",
  group: "initiativeRecords",
  subject: ({ initiativeId }) => ({ kind: "initiative", id: initiativeId }),
});

/** Office action: Mark Ready, from Backlog or Planning. */
export const MARK_TASK_READY_ACTION = officeAction({
  name: "mark_task_ready",
  title: "Mark a Task Ready",
  description:
    "Marks a Task Ready, from Backlog or Planning: refused with every reason until its Plan and Definition of Done are confirmed, no Pipeline proposal is open and no Decision is. With confirmPlanAndDefinitionOfDone, the Plan and the Definition of Done are confirmed as they stand, even empty, in the same change; use it only when the user told you to go on without them.",
  input: markReadyRequestSchema.extend({ taskId: taskIdInput }),
  answer: taskSchema,
  route: { method: "POST", path: "/tasks/:taskId/ready" },
  area: "work",
  group: "movingWork",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: Confirm the Task's Plan as it reads. */
export const CONFIRM_TASK_PLAN_ACTION = officeAction({
  name: "confirm_task_plan",
  title: "Confirm a Task's Plan",
  description: "Confirms a Task's Plan as it reads now.",
  input: z.object({ taskId: taskIdInput }),
  answer: taskSchema,
  route: { method: "POST", path: "/tasks/:taskId/plan/confirm" },
  area: "work",
  group: "movingWork",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: Confirm the Task's Definition of Done as it reads. */
export const CONFIRM_TASK_DEFINITION_OF_DONE_ACTION = officeAction({
  name: "confirm_task_definition_of_done",
  title: "Confirm a Task's Definition of Done",
  description: "Confirms a Task's Definition of Done as it reads now.",
  input: z.object({ taskId: taskIdInput }),
  answer: taskSchema,
  route: { method: "POST", path: "/tasks/:taskId/definition-of-done/confirm" },
  area: "work",
  group: "movingWork",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: the Task's Pipeline: the proposed one confirmed, or another. */
export const CHOOSE_TASK_PIPELINE_ACTION = officeAction({
  name: "choose_task_pipeline",
  title: "Choose a Task's Pipeline",
  description:
    "Sets a Task's Pipeline by its id: the proposed one to confirm it, or another from the library. Either ends the Pipeline proposal.",
  input: pipelineChangeSchema.extend({ taskId: taskIdInput }),
  answer: taskSchema,
  route: { method: "PUT", path: "/tasks/:taskId/pipeline" },
  area: "work",
  group: "movingWork",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: the Task's engine override and each person's model and effort. */
export const CHOOSE_TASK_ENGINE_ACTION = officeAction({
  name: "choose_task_engine",
  title: "Choose a Task's engine",
  description:
    "Sets a Task's engine override, null for none, and its model and effort for each person (people left out keeps them, null or empty clears them), in any state but Done and Dropped. Refused for an engine not listed, when a Role of its Pipeline couldn't run on it, and for a model or effort the engine type doesn't offer.",
  input: taskEngineChangeSchema.extend({ taskId: taskIdInput }),
  answer: taskSchema,
  route: { method: "PUT", path: "/tasks/:taskId/engine" },
  area: "work",
  group: "movingWork",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: the Task's place on the board. */
export const PLACE_TASK_ACTION = officeAction({
  name: "place_task",
  title: "Place a Task on the board",
  description:
    "Places a Task on the board between two Tasks of its column, null at either end: it takes the priority that keeps it there.",
  input: taskPlacementSchema.extend({ taskId: taskIdInput }),
  answer: taskSchema,
  route: { method: "PUT", path: "/tasks/:taskId/place" },
  area: "work",
  group: "movingWork",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: Make a plan, the Planner starting at once. */
export const MAKE_A_PLAN_ACTION = officeAction({
  name: "make_a_plan",
  title: "Make a Plan",
  description:
    "Make a plan: the Task moves to Planning, in auto mode or not, and the Planner starts at once from its title and Description. The choice becomes the remembered default.",
  input: makeAPlanSchema.extend({ taskId: taskIdInput }),
  answer: taskSchema,
  route: { method: "POST", path: "/tasks/:taskId/make-a-plan" },
  area: "work",
  group: "movingWork",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: Plan with…, the planning Thread open for the first message. */
export const PLAN_WITH_ACTION = officeAction({
  name: "plan_with",
  title: "Plan with the Planner",
  description:
    "Plan with…: the Task moves to Planning, and its planning Thread opens for the first message.",
  input: z.object({ taskId: taskIdInput }),
  answer: taskSchema,
  route: { method: "POST", path: "/tasks/:taskId/planning" },
  area: "work",
  group: "movingWork",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: Start the Task, or queue it when only waits hold it. */
export const START_TASK_ACTION = officeAction({
  name: "start_task",
  title: "Start a Task",
  description:
    "Starts a Ready Task: In progress, or into the queue when only a blocker or a limit holds it, or when onOverlap queues it behind an Overlap; refused with the reasons when anything else does, or an Overlap not answered. With onUsageCaps start-anyway it starts past its usage caps, with onLimits start-anyway past the Office-wide and Project limits, and never queues.",
  input: startRequestFieldsSchema.extend({ taskId: taskIdInput }),
  answer: startAnswerSchema,
  route: { method: "POST", path: "/tasks/:taskId/start" },
  area: "work",
  group: "movingWork",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: Pause the Task. */
export const PAUSE_TASK_ACTION = officeAction({
  name: "pause_task",
  title: "Pause a Task",
  description: "Pauses a Task: it is held, its running Stage once the Agent's current turn ends.",
  input: z.object({ taskId: taskIdInput }),
  answer: taskSchema,
  route: { method: "POST", path: "/tasks/:taskId/pause" },
  area: "work",
  group: "movingWork",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: Stop the Task, interrupting the Stage running now. */
export const STOP_TASK_ACTION = officeAction({
  name: "stop_task",
  title: "Stop a Task",
  description:
    "Stops a Task: the Stage running now is interrupted, its uncommitted edits discarded, and the Task held.",
  input: z.object({ taskId: taskIdInput }),
  answer: taskSchema,
  route: { method: "POST", path: "/tasks/:taskId/stop" },
  area: "work",
  group: "movingWork",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: Resume a Paused Task. */
export const RESUME_TASK_ACTION = officeAction({
  name: "resume_task",
  title: "Resume a Task",
  description: "Resumes a Paused Task: it goes on through the Context policy.",
  input: z.object({ taskId: taskIdInput }),
  answer: taskSchema,
  route: { method: "POST", path: "/tasks/:taskId/resume" },
  area: "work",
  group: "movingWork",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: Move the Task to another Project. */
export const MOVE_TASK_ACTION = officeAction({
  name: "move_task",
  title: "Move a Task to another Project",
  description:
    "Moves a Task to another Project: it goes back to Backlog with its Plan and Definition of Done Not confirmed. Refused with every reason it can't move.",
  input: taskMoveSchema.extend({ taskId: taskIdInput }),
  answer: taskSchema,
  route: { method: "POST", path: "/tasks/:taskId/move" },
  area: "work",
  group: "movingWork",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: Take the Task out of the queue for Start. */
export const TAKE_OUT_OF_QUEUE_ACTION = officeAction({
  name: "take_out_of_queue",
  title: "Take a Task out of the queue",
  description: "Takes a Task out of the queue for Start: it stays Ready.",
  input: z.object({ taskId: taskIdInput }),
  answer: z.object({}),
  route: { method: "DELETE", path: "/queue/:taskId" },
  area: "work",
  group: "movingWork",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: Move the Task up one place in the queue. */
export const MOVE_UP_IN_QUEUE_ACTION = officeAction({
  name: "move_up_in_queue",
  title: "Move a Task up in the queue",
  description: "Moves a queued Task up one place, past the Task ahead of it.",
  input: z.object({ taskId: taskIdInput }),
  answer: z.object({}),
  route: { method: "POST", path: "/queue/:taskId/move-up" },
  area: "work",
  group: "movingWork",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: Move the Task to the top of the queue. */
export const MOVE_TO_TOP_OF_QUEUE_ACTION = officeAction({
  name: "move_to_top_of_queue",
  title: "Move a Task to the top of the queue",
  description: "Moves a queued Task to the first place, ahead of every other queued Task.",
  input: z.object({ taskId: taskIdInput }),
  answer: z.object({}),
  route: { method: "POST", path: "/queue/:taskId/move-to-top" },
  area: "work",
  group: "movingWork",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: Resolve conflicts on the pull request the Task opened. */
export const RESOLVE_CONFLICTS_ACTION = officeAction({
  name: "resolve_conflicts",
  title: "Resolve a Task's conflicts",
  description:
    "Resolve conflicts on the pull request a Task opened: its open Conflict resolution Task, or one made and started now; Ready with Start's reasons when Start refused it.",
  input: z.object({ taskId: taskIdInput }),
  answer: conflictResolutionAnswerSchema,
  route: { method: "POST", path: "/tasks/:taskId/resolve-conflicts" },
  area: "work",
  group: "movingWork",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: save the board's filters as a view. */
export const SAVE_VIEW_ACTION = officeAction({
  name: "save_view",
  title: "Save a view",
  description: "Saves the Work board's filters under a name, as a Saved view everyone sees.",
  input: newSavedViewSchema,
  answer: savedViewSchema,
  route: { method: "POST", path: "/saved-views" },
  area: "work",
  group: "movingWork",
  // A new view has no id yet: its name stands for it in the record of the call.
  subject: ({ name }) => ({ kind: "saved-view", id: name }),
});

/** Office action: delete a Saved view. */
export const DELETE_VIEW_ACTION = officeAction({
  name: "delete_view",
  title: "Delete a view",
  description: "Deletes a Saved view of the Work board.",
  input: z.object({ id: z.uuid().describe("The id of the Saved view.") }),
  answer: z.object({}),
  route: { method: "DELETE", path: "/saved-views/:id" },
  area: "work",
  group: "movingWork",
  subject: ({ id }) => ({ kind: "saved-view", id }),
});

/** Office action: the Task's commit message, until Publish lands it; empty takes the default again. */
export const WRITE_COMMIT_MESSAGE_ACTION = officeAction({
  name: "write_commit_message",
  description:
    "Writes the Task's commit message: the message of the one commit Publish lands the Task as on its base, and of its pull request (the first line its title, the rest its body). Follow the commit convention the Project's own docs define (CLAUDE.md, AGENTS.md, README, CONTRIBUTING and the like); with none, write the Task's title with a short summary of the change below it. It replaces the message the Task has, applies at once and never moves the Task; the user can change it until Publish. An empty message takes the default again. Refused once the Task is Done or Dropped, or once Publish has landed it.",
  input: z.object({
    taskId: taskIdInput,
    message: z
      .string()
      .describe("The whole commit message: its subject line, a blank line, then its body."),
  }),
  answer: taskSchema,
  title: "Write the Task's commit message",
  route: { method: "PUT", path: "/tasks/:taskId/commit-message" },
  area: "work",
  group: "taskRecords",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: a link on the Task's Attachments; an empty name is the URL. */
export const ATTACH_LINK_ACTION = officeAction({
  name: "attach_link",
  description:
    "Attaches a link to the Task, such as a page you used or a preview of the work, for the user to see with the Task.",
  input: z.object({
    taskId: taskIdInput,
    url: z.string().describe("The web address, starting http:// or https://."),
    name: z.string().optional().describe("What the link is, in a few words."),
  }),
  answer: attachmentSchema,
  title: "Attach a link to a Task",
  route: { method: "POST", path: "/tasks/:taskId/attachments/links" },
  status: 201,
  area: "work",
  group: "taskRecords",
  subject: ({ taskId }) => ({ kind: "task", id: taskId }),
});

/** Office action: Onboard, and Onboard again, a Project. */
export const ONBOARD_PROJECT_ACTION = officeAction({
  name: "onboard_project",
  title: "Onboard a Project",
  description:
    "Onboards a Project, or onboards it again once its latest Onboard Task is Done or Dropped: its Onboard Task is started or queued at once, the open one while there is one, or refused with nothing made.",
  input: z.object({ projectId: z.string().min(1).describe("The id of the Project.") }),
  answer: offBoardTaskStartSchema,
  route: { method: "POST", path: "/projects/:projectId/onboard" },
  area: "projectsAndSettings",
  group: "projectSettings",
  subject: ({ projectId }) => ({ kind: "project", id: projectId }),
});

/** Work's Office actions, each declared above. */
export const WORK_OFFICE_ACTIONS = [
  SOUND_FIRE_ALARM_ACTION,
  ONBOARD_PROJECT_ACTION,
  ADD_DEPENDENCY_ACTION,
  REMOVE_DEPENDENCY_ACTION,
  ADD_TO_INITIATIVE_ACTION,
  TAKE_OUT_OF_INITIATIVE_ACTION,
  ADD_TASK_ACTION,
  CHOOSE_PIPELINE_ACTION,
  CHANGE_TASK_TITLE_ACTION,
  CHANGE_TASK_DESCRIPTION_ACTION,
  CHANGE_TASK_KIND_ACTION,
  CHANGE_TASK_PRIORITY_ACTION,
  CHANGE_TASK_PLAN_ACTION,
  CHANGE_TASK_DEFINITION_OF_DONE_ACTION,
  WRITE_COMMIT_MESSAGE_ACTION,
  ATTACH_LINK_ACTION,
  DROP_TASK_ACTION,
  ARCHIVE_TASK_ACTION,
  RESTORE_TASK_ACTION,
  START_TASK_OVER_ACTION,
  REOPEN_TASK_ACTION,
  EDIT_IDEA_ACTION,
  DROP_IDEA_ACTION,
  RESTORE_IDEA_ACTION,
  WRITE_INITIATIVE_OUTCOME_ACTION,
  DROP_INITIATIVE_ACTION,
  ARCHIVE_INITIATIVE_ACTION,
  RESTORE_INITIATIVE_ACTION,
  SHAPE_IDEA_INTO_TASK_ACTION,
  SHAPE_IDEA_INTO_INITIATIVE_ACTION,
  PLAN_IDEA_AS_TASK_ACTION,
  CONFIRM_INITIATIVE_ACTION,
  INITIATIVE_BACK_TO_SHAPING_ACTION,
  START_READY_TASKS_ACTION,
  PAUSE_INITIATIVE_ACTION,
  RESUME_INITIATIVE_ACTION,
  SET_INITIATIVE_ENGINE_ACTION,
  WRITE_INITIATIVE_SHORT_NAME_ACTION,
  MARK_TASK_READY_ACTION,
  CONFIRM_TASK_PLAN_ACTION,
  CONFIRM_TASK_DEFINITION_OF_DONE_ACTION,
  CHOOSE_TASK_PIPELINE_ACTION,
  CHOOSE_TASK_ENGINE_ACTION,
  PLACE_TASK_ACTION,
  MAKE_A_PLAN_ACTION,
  PLAN_WITH_ACTION,
  START_TASK_ACTION,
  PAUSE_TASK_ACTION,
  STOP_TASK_ACTION,
  RESUME_TASK_ACTION,
  MOVE_TASK_ACTION,
  TAKE_OUT_OF_QUEUE_ACTION,
  MOVE_UP_IN_QUEUE_ACTION,
  MOVE_TO_TOP_OF_QUEUE_ACTION,
  RESOLVE_CONFLICTS_ACTION,
  SAVE_VIEW_ACTION,
  DELETE_VIEW_ACTION,
] as const;

/** Office action: the Office-wide limit of Settings › Office limits. */
export const SET_OFFICE_WIDE_LIMIT_ACTION = officeAction({
  name: "set_office_wide_limit",
  title: "Change the Office-wide limit",
  description: `Sets how many Tasks may run at once across The Office, from 1 to ${OFFICE_WIDE_LIMIT_MAX}, and answers the new limit.`,
  input: officeWideLimitSchema,
  answer: officeWideLimitSchema,
  route: { method: "PUT", path: "/settings/office-wide-limit" },
  area: "officeSettings",
  group: "officeSettings",
  subject: () => ({ kind: "office-setting", id: "office-wide-limit" }),
});

/** Office action: the Archive period of Settings › Office limits. */
export const SET_ARCHIVE_PERIOD_ACTION = officeAction({
  name: "set_archive_period",
  title: "Change the Archive period",
  description: `Sets how many days, from 1 to ${ARCHIVE_PERIOD_MAX}, a Done or Dropped Task stays on the board before it is archived, and answers the new period.`,
  input: archivePeriodSchema,
  answer: archivePeriodSchema,
  route: { method: "PUT", path: "/settings/archive-period" },
  area: "officeSettings",
  group: "officeSettings",
  subject: () => ({ kind: "office-setting", id: "archive-period" }),
});

/** Office action: Usage in Settings › Office limits, the measures and every engine's caps. */
export const SET_USAGE_SETTINGS_ACTION = officeAction({
  name: "set_usage_settings",
  title: "Change Usage",
  description:
    "Sets the ticked usage measures (none turns estimates off) and the caps of every engine, each engine once: Window caps only on an engine with usage windows, and the Daily caps on tokens and dollars, null for none. It is sent whole, so read the engines first, and answers the settings saved.",
  input: usageSettingsSchema,
  answer: usageSettingsSchema,
  route: { method: "PUT", path: "/settings/usage" },
  area: "officeSettings",
  group: "officeSettings",
  subject: () => ({ kind: "office-setting", id: "usage" }),
});

/** Work's Office actions on Office settings, each declared above. */
export const WORK_SETTINGS_OFFICE_ACTIONS = [
  SET_OFFICE_WIDE_LIMIT_ACTION,
  SET_ARCHIVE_PERIOD_ACTION,
  SET_USAGE_SETTINGS_ACTION,
] as const;
