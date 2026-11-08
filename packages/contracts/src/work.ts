import { z } from "zod";
import { webEventSchema } from "./events.js";
import { engineIdSchema } from "./engines.js";
import type { ProjectFilter } from "./project-filter.js";

/** Who captured, created or attached something: the user, or a person by their Role's key. */
export const authorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user") }),
  z.object({ kind: z.literal("person"), roleKey: z.string() }),
]);
export type Author = z.infer<typeof authorSchema>;

export const ideaStateSchema = z.enum(["new", "shaped", "dropped"]);
export type IdeaState = z.infer<typeof ideaStateSchema>;

/** What the user gives to capture an Idea (POST /ideas); a null Project is Office-wide. */
export const newIdeaSchema = z.object({
  title: z.string(),
  notes: z.string(),
  projectId: z.string().nullable(),
});
export type NewIdea = z.infer<typeof newIdeaSchema>;

export const ideaSchema = newIdeaSchema.extend({
  id: z.uuid(),
  state: ideaStateSchema,
  /** The Task it was shaped into. */
  taskId: z.uuid().nullable(),
  /** The Initiative it was shaped into. */
  initiativeId: z.uuid().nullable(),
  capturedBy: authorSchema,
  capturedAt: z.iso.datetime(),
  droppedAt: z.iso.datetime().nullable(),
});
export type Idea = z.infer<typeof ideaSchema>;

export const ideaListSchema = z.array(ideaSchema);

/** POST /ideas/:id/shape: the Project the Task is made in. */
export const ideaShapingSchema = z.object({ projectId: z.string() });
export type IdeaShaping = z.infer<typeof ideaShapingSchema>;

export const initiativeStateSchema = z.enum(["shaping", "active", "done", "dropped"]);
export type InitiativeState = z.infer<typeof initiativeStateSchema>;

/** POST /ideas/:id/initiative makes one, being shaped; its Tasks name it. */
export const initiativeSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** Empty until written. */
  outcome: z.string(),
  state: initiativeStateSchema,
  originIdeaId: z.uuid(),
  /** The Projects of its Tasks, each once. */
  projectIds: z.array(z.string()),
  createdBy: authorSchema,
  createdAt: z.iso.datetime(),
});
export type Initiative = z.infer<typeof initiativeSchema>;

/** The newest first. */
export const initiativeListSchema = z.array(initiativeSchema);

/** PUT /initiatives/:id/outcome: the user's outcome, written while the Initiative is being shaped. */
export const outcomeChangeSchema = z.object({ outcome: z.string() });
export type OutcomeChange = z.infer<typeof outcomeChangeSchema>;

export const taskStateSchema = z.enum([
  "shaping",
  "backlog",
  "planning",
  "ready",
  "in-progress",
  "waiting-on-you",
  "paused",
  "done",
  "dropped",
]);
export type TaskState = z.infer<typeof taskStateSchema>;

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

export const taskSchema = newTaskSchema.extend({
  id: z.uuid(),
  state: taskStateSchema,
  /** Paused by the fire alarm, apart from the user's own Pause; the all clear resumes it. */
  pausedByAlarm: z.boolean(),
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
  /** The Pipeline its work follows. */
  pipelineId: z.string(),
  /** The Pipeline the Planner proposes, until the user confirms it or chooses another. */
  proposedPipeline: proposedPipelineSchema.nullable(),
  /** The Tasks that must be Done before it can start, in the order added; a Dropped one no longer blocks. */
  blockedBy: z.array(z.uuid()),
  originIdeaId: z.uuid().nullable(),
  /** The Initiative it is part of (POST /initiatives/:id/tasks). */
  initiativeId: z.uuid().nullable(),
  createdBy: authorSchema,
  createdAt: z.iso.datetime(),
  /**
   * When it was archived, while it is: a mark on a Done or Dropped Task, never a state, that takes
   * it off the board and its lists; null on the board.
   */
  archivedAt: z.iso.datetime().nullable(),
});
export type Task = z.infer<typeof taskSchema>;

/** Every Task, in the board's order: by priority, then by manual order. */
export const taskListSchema = z.array(taskSchema);

/**
 * A Project's onboarding, read from its Onboard Task: onboarding until the Task is done, then
 * onboarded. A Project without one, or whose Onboard Task was dropped, has none.
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

/** PUT /tasks/:id/description: the Description as the user rewrote it; empty leaves none. */
export const descriptionChangeSchema = z.object({ description: z.string() });
export type DescriptionChange = z.infer<typeof descriptionChangeSchema>;

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
 * PUT /tasks/:id/place: the Tasks it lands between in its column of the board, null at either
 * end. It takes the priority that keeps it there.
 */
export const taskPlacementSchema = z.object({
  above: z.uuid().nullable(),
  below: z.uuid().nullable(),
});
export type TaskPlacement = z.infer<typeof taskPlacementSchema>;

/** POST /tasks/:id/dependencies: the Task waits for this one; DELETE /tasks/:id/dependencies/:blockerId ends it. */
export const newDependencySchema = z.object({ blockerId: z.uuid() });
export type NewDependency = z.infer<typeof newDependencySchema>;

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
 * engine). A ticked window or cost is null when there is no estimate of it: no reading to learn
 * from, or ("no cost") a model with no Model price.
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
});
export type StartCheck = z.infer<typeof startCheckSchema>;

/**
 * The user's answer to an Overlap at Start: "start-anyway", or "queue-behind" the Tasks it
 * overlaps until each is Done or Dropped.
 */
export const overlapChoiceSchema = z.enum(["start-anyway", "queue-behind"]);
export type OverlapChoice = z.infer<typeof overlapChoiceSchema>;

/**
 * POST /tasks/:id/start: the answer to an Overlap; while one stands, Start without it refuses. No
 * body is no answer.
 */
export const startRequestSchema = z
  .object({ onOverlap: overlapChoiceSchema.optional() })
  .default({});
export type StartRequest = z.infer<typeof startRequestSchema>;

/** A Task in the one Office-wide queue for Start, with the waits that hold it. */
export const queuedTaskSchema = z.object({
  taskId: z.uuid(),
  /** 1 for the Task first in the queue. */
  place: z.number().int().positive(),
  queuedAt: z.iso.datetime(),
  reasons: z.array(z.string()),
  /** The Tasks it was queued behind for an Overlap, each until it is Done or Dropped. */
  behind: z.array(z.uuid()),
});
export type QueuedTask = z.infer<typeof queuedTaskSchema>;

/**
 * GET /queue: every queued Task, first place first. DELETE /queue/:taskId takes one out;
 * POST /queue/:taskId/move-up moves it one place up.
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
  }),
]);
export type Attachment = z.infer<typeof attachmentSchema>;

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
 * The query of GET /search: the words, and the Projects the Project filter shows as one `project`
 * each, every Project when none is named.
 */
export const searchEverythingQuerySchema = searchQuerySchema.extend({
  project: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((project): ProjectFilter => {
      const projectIds = typeof project === "string" ? [project] : (project ?? []);
      return projectIds.length === 0 ? "all" : projectIds;
    }),
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

/** A Window cap: the % of the window a Start may bring it to. */
export const windowCapSchema = z.int().min(1).max(100);

/**
 * The caps on one engine (spec §2.2), each null when off: a Window cap on each window, exactly on a
 * Claude Code engine, as only its account has them (the service refuses windows elsewhere), and the
 * Daily caps on tokens and on dollars.
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
 * GET /fire-alarm, and what POST /fire-alarm/sound answers (spec §2.8): off, or on since it was
 * sounded.
 */
export const fireAlarmSchema = z.discriminatedUnion("on", [
  z.object({ on: z.literal(false) }),
  z.object({ on: z.literal(true), since: z.iso.datetime() }),
]);
export type FireAlarm = z.infer<typeof fireAlarmSchema>;

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
  webEventSchema.extend({ type: z.literal("task.description-changed"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.tags-changed"), taskId: z.uuid() }),
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
  webEventSchema.extend({ type: z.literal("task.plan-proposed"), taskId: z.uuid() }),
  webEventSchema.extend({ type: z.literal("task.plan-saved"), taskId: z.uuid() }),
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
  /** The ticked measures or a cap changed: Settings › Office limits and the estimates read again. */
  webEventSchema.extend({ type: z.literal("usage-settings.changed") }),
  /** The fire alarm sounded, or the all clear was given: every tab reads it again, and its lifts. */
  webEventSchema.extend({ type: z.literal("fire-alarm.sounded") }),
  webEventSchema.extend({ type: z.literal("fire-alarm.all-clear") }),
]);
export type WorkWebEvent = z.infer<typeof workWebEventSchema>;
