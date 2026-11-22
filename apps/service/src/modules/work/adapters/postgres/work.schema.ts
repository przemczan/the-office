import { sql, type SQL } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { AttachmentKind } from "../../domain/attachment.js";
import type { ArchivedBy, Author } from "../../domain/author.js";
import type { DropReasonKind } from "../../domain/drop-reason.js";
import type { IdeaState } from "../../domain/idea.js";
import type { InitiativeState } from "../../domain/initiative.js";
import type { EngineStandIn } from "../../domain/stand-ins-at-start.js";
import type { StateChangeCause } from "../../domain/state-change.js";
import type {
  Priority,
  ProposedPipeline,
  TaskHolder,
  TaskKind,
  TaskMadeFor,
  TaskState,
} from "../../domain/task.js";
import type { PullRequestEnd, PullRequestMergeMethod } from "../../domain/task-pull-request.js";
import { boardOrderOf } from "./board-order.js";
import { searchVectorOf, taskSearchVector } from "./search-vector.js";

// The tables are in one file because Ideas, Initiatives and Tasks name each other.

/**
 * An Author as jsonb keeps it: a user's from before users existed has no `user` until the first
 * user claims it (`WorkEarlierRecords`), and reads as `user: null` (`authorOf`).
 */
export type AuthorRow = Author | { readonly kind: "user"; readonly user?: undefined };

/**
 * A state change's cause as jsonb keeps it: an Author's as `AuthorRow`, and a start by the queue
 * kept before who queued it was has no `queuedBy` (`causeOf`).
 */
export type StateChangeCauseRow =
  | Exclude<StateChangeCause, { readonly kind: "user" | "queue" }>
  | AuthorRow
  | { readonly kind: "queue"; readonly queuedBy?: AuthorRow | null };

/** A Task's Move to another Project as jsonb keeps it: its time as an ISO string. */
export interface ProjectMoveRow {
  readonly from: string;
  readonly to: string;
  readonly at: string;
  readonly by: AuthorRow;
}

/** How a Task's pull request ended as jsonb keeps it: its time as an ISO string. */
export interface PullRequestEndRow {
  readonly outcome: PullRequestEnd["outcome"];
  readonly number: number;
  readonly url: string;
  readonly at: string;
  readonly method: PullRequestMergeMethod | null;
  readonly by: AuthorRow | { readonly kind: "code-host"; readonly name: string };
}

/** A branch's deletion as jsonb keeps it: its time as an ISO string. */
export interface BranchDeletionRow {
  readonly branch: string;
  readonly copies: readonly { readonly kind: "local" | "remote"; readonly name: string }[];
  readonly by: AuthorRow | { readonly kind: "office" };
  readonly at: string;
}

export const ideas = pgTable("ideas", {
  id: uuid("id").primaryKey(),
  title: text("title").notNull(),
  notes: text("notes").notNull(),
  /** Null for an Idea captured Office-wide. */
  projectId: text("project_id"),
  state: text("state").$type<IdeaState>().notNull(),
  taskId: uuid("task_id").references((): AnyPgColumn => tasks.id),
  initiativeId: uuid("initiative_id").references((): AnyPgColumn => initiatives.id),
  capturedBy: jsonb("captured_by").$type<AuthorRow>().notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  droppedAt: timestamp("dropped_at", { withTimezone: true }),
});

/** An Initiative's Pipeline in one Project, as kept in its row; null for None. */
export interface InitiativePipelineRow {
  readonly projectId: string;
  readonly pipelineId: string | null;
}

/** The Initiative's branch in one Project as jsonb keeps it: its time as an ISO string. */
export interface InitiativeBranchRow {
  readonly projectId: string;
  readonly madeAt: string;
  /** Absent while the branch is kept. */
  readonly deletion?: BranchDeletionRow;
}

/** Its Tasks name it; the Projects it spans are theirs. */
export const initiatives = pgTable(
  "initiatives",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    outcome: text("outcome").notNull(),
    state: text("state").$type<InitiativeState>().notNull(),
    /** Null for one created with create_initiative, from no Idea. */
    originIdeaId: uuid("origin_idea_id").references((): AnyPgColumn => ideas.id),
    createdBy: jsonb("created_by").$type<AuthorRow>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    /** Null while it is shaping or active, and for one that ended before this was kept. */
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** Null while it isn't archived. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /** Null while it isn't archived, and for one archived before who did was kept. */
    archivedBy: jsonb("archived_by").$type<ArchivedBy>(),
    /** Null until it is first restored from the Archive. */
    restoredAt: timestamp("restored_at", { withTimezone: true }),
    /** Null until it is first restored; the user, unnamed, for a Restore from before users. */
    restoredBy: jsonb("restored_by").$type<AuthorRow>(),
    /** Null while it isn't paused. */
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    /** Its latest planning Thread, kept by Conversations; null until it is first planned. */
    planningThreadId: uuid("planning_thread_id"),
    /** Every planning Thread it opened, oldest first (Initiative.planningThreadIds). */
    planningThreadIds: uuid("planning_thread_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    /** Who asked for its latest planning Thread; null until it is first planned. */
    planningStartedBy: jsonb("planning_started_by").$type<AuthorRow>(),
    planningAutoMode: boolean("planning_auto_mode").notNull().default(false),
    /** Whether its latest planning Thread was opened by Plan with…, waiting for the user. */
    planningWithUser: boolean("planning_with_user").notNull().default(false),
    /**
     * The Initiative's Pipeline in each Project it was given one or None for (Initiative.pipelines);
     * a Project without an entry has None.
     */
    pipelines: jsonb("pipelines")
      .$type<InitiativePipelineRow[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Null while no Project has a Pipeline; unique among those that have one, whatever their state. */
    shortName: text("short_name"),
    /** The Projects its branch was made in, oldest first; kept after a Drop, as the branches are. */
    branches: jsonb("branches")
      .$type<InitiativeBranchRow[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** The Initiative's engine (spec 5.4.5), kept by Engine, so no foreign key; null for none. */
    engineId: text("engine_id"),
    /** Its engine's model; null exactly when `engine_id` is. */
    model: text("model"),
  },
  (table) => [
    uniqueIndex("initiatives_short_name_unique")
      .on(table.shortName)
      .where(sql`${table.shortName} is not null`),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey(),
    title: text("title").notNull(),
    projectId: text("project_id").notNull(),
    state: text("state").$type<TaskState>().notNull(),
    priority: text("priority").$type<Priority>().notNull(),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'`),
    /** Sorted by its code units, as the board compares them: `board-order.ts`. */
    order: text("order_key").notNull(),
    description: text("description").notNull().default(""),
    plan: text("plan").notNull(),
    planConfirmed: boolean("plan_confirmed").notNull().default(false),
    filesToChange: text("files_to_change")
      .array()
      .notNull()
      .default(sql`'{}'`),
    /** The Planner's token estimate in the Plan; null when it gave none. */
    estimatedTokens: bigint("estimated_tokens", { mode: "number" }),
    definitionOfDone: text("definition_of_done")
      .array()
      .notNull()
      .default(sql`'{}'`),
    definitionOfDoneConfirmed: boolean("definition_of_done_confirmed").notNull().default(false),
    /** Empty while none is written, and Publish takes the default. */
    commitMessage: text("commit_message").notNull().default(""),
    /** Null until Publish lands the commit message. */
    commitMessagePublishedAt: timestamp("commit_message_published_at", { withTimezone: true }),
    /** Null until the Task's Pipeline is chosen. */
    pipelineId: text("pipeline_id"),
    /** Null while the Planner proposes none. */
    proposedPipeline: jsonb("proposed_pipeline").$type<ProposedPipeline>(),
    autoMode: boolean("auto_mode").notNull().default(false),
    /** The Initiative's planning Thread it is planned in, kept by Conversations; null otherwise. */
    initiativePlanningThreadId: uuid("initiative_planning_thread_id"),
    markedPlanned: boolean("marked_planned").notNull().default(false),
    hasPlanningThread: boolean("has_planning_thread").notNull().default(false),
    /** Null until the Task starts, and for a Pipeline without an Agent Stage. */
    personRole: text("person_role"),
    /** The Stand-in Engines its last Start chose; engines are kept by Engine, so no foreign key. */
    engineStandIns: jsonb("engine_stand_ins")
      .$type<EngineStandIn[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** Null unless the fire alarm, its Initiative's Pause or the usage window holds it Paused. */
    pausedBy: text("paused_by").$type<TaskHolder>(),
    /** Null unless the usage window paused it: the window's reset, when it resumes by itself. */
    resumesAt: timestamp("resumes_at", { withTimezone: true }),
    /**
     * Null unless the usage window paused it: the engine whose window did, kept by Engine, so no
     * foreign key; null too for one paused before it was kept, which resumes at its reset.
     */
    usageWindowEngineId: text("usage_window_engine_id"),
    /** Null unless the usage window paused it: when it last did, by The Office's clock. */
    usageWindowPausedAt: timestamp("usage_window_paused_at", { withTimezone: true }),
    /** Null for a Task the user or an Agent made. */
    madeFor: text("made_for").$type<TaskMadeFor>(),
    /** The Task whose pull request's conflicts a Conflict resolution Task resolves; null otherwise. */
    resolvesTaskId: uuid("resolves_task_id"),
    /** The Tasks it waits for, in the order added; a Task is dropped, never deleted, so ids hold. */
    blockedBy: uuid("blocked_by")
      .array()
      .notNull()
      .default(sql`'{}'`),
    originIdeaId: uuid("origin_idea_id").references((): AnyPgColumn => ideas.id),
    initiativeId: uuid("initiative_id").references((): AnyPgColumn => initiatives.id),
    /** Each Move to another Project, oldest first; kept on the row, as it saves with the Task. */
    projectMoves: jsonb("project_moves")
      .$type<ProjectMoveRow[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdBy: jsonb("created_by").$type<AuthorRow>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    /** Null while it isn't archived. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /** Null while it isn't archived, and for one archived before who did was kept. */
    archivedBy: jsonb("archived_by").$type<ArchivedBy>(),
    /** Null until it is first restored from the Archive. */
    restoredAt: timestamp("restored_at", { withTimezone: true }),
    /** Null until it is first restored; the user, unnamed, for a Restore from before users. */
    restoredBy: jsonb("restored_by").$type<AuthorRow>(),
    /** Null while it hasn't ended, and for one whose end was never recorded. */
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** Null while its pull request hasn't ended, or is open again. */
    pullRequestEnd: jsonb("pull_request_end").$type<PullRequestEndRow>(),
    /** Null while The Office deleted none of its branch. */
    branchDeletion: jsonb("branch_deletion").$type<BranchDeletionRow>(),
    /** Feature, Bug or Chore; a row from before Kinds is a Feature, or a Chore when The Office made it. */
    kind: text("kind").$type<TaskKind>().notNull().default("feature"),
    /** Null unless it was Dropped with a reason. */
    dropReason: text("drop_reason").$type<DropReasonKind>(),
    /** The words of an Other drop reason; null for any other. */
    dropReasonText: text("drop_reason_text"),
    /** The Task a Duplicate drop reason names; null for any other. */
    duplicateOfTaskId: uuid("duplicate_of_task_id").references((): AnyPgColumn => tasks.id),
    /** The Task whose work caused this Bug; null for none. */
    causedByTaskId: uuid("caused_by_task_id").references((): AnyPgColumn => tasks.id),
    /** Free text; null for none. */
    foundInVersion: text("found_in_version"),
    /** The Task whose Pipeline found this Bug; null otherwise. */
    foundWhileWorkingOnTaskId: uuid("found_while_working_on_task_id").references(
      (): AnyPgColumn => tasks.id,
    ),
    /**
     * Whether The Office created it by itself; `created_by` still names an Author, which the
     * previous release reads.
     */
    createdByTheOffice: boolean("created_by_the_office").notNull().default(false),
    /** The Task's engine (spec 5.4.5), kept by Engine, so no foreign key; null for none. */
    engineId: text("engine_id"),
    /** Its engine's model; null exactly when `engine_id` is. */
    model: text("model"),
  },
  (table) => [
    uniqueIndex("tasks_order_key").on(table.order),
    // The board's read, the Tasks not archived in its order, reads this in order with no sort.
    index("tasks_board_order")
      .on(...boardOrderOf(table))
      .where(sql`${table.archivedAt} IS NULL`),
    index("tasks_search").using("gin", taskSearchVector(table)),
    index("tasks_initiative").on(table.initiativeId),
    index("tasks_kind_idx").on(table.kind),
    index("tasks_caused_by_idx")
      .on(table.causedByTaskId)
      .where(sql`${table.causedByTaskId} IS NOT NULL`),
    // A Project has one open Onboard Task at most: Onboard again makes another once it ended.
    uniqueIndex("tasks_open_onboard_task_per_project")
      .on(table.projectId)
      .where(sql`${table.madeFor} = 'onboard' AND ${table.state} NOT IN ('done', 'dropped')`),
    // And one open "Set up the run environment" Task, which asking again answers.
    uniqueIndex("tasks_open_run_environment_set_up_per_project")
      .on(table.projectId)
      .where(
        sql`${table.madeFor} = 'run-environment-setup' AND ${table.state} NOT IN ('done', 'dropped')`,
      ),
    // And one open "Set up test targets" Task, the same way.
    uniqueIndex("tasks_open_test_targets_set_up_per_project")
      .on(table.projectId)
      .where(
        sql`${table.madeFor} = 'test-targets-setup' AND ${table.state} NOT IN ('done', 'dropped')`,
      ),
    // And one unfinished Publishing Task per Initiative there, which two done checks racing meet.
    uniqueIndex("tasks_open_publishing_task_per_project")
      .on(table.initiativeId, table.projectId)
      .where(sql`${table.madeFor} = 'publishing' AND ${table.state} NOT IN ('done', 'dropped')`),
    // And one open Conflict resolution Task per Task whose pull request it resolves.
    uniqueIndex("tasks_open_conflict_resolution_per_task")
      .on(table.resolvesTaskId)
      .where(
        sql`${table.madeFor} = 'resolve-conflicts' AND ${table.state} NOT IN ('done', 'dropped')`,
      ),
  ],
);

/**
 * A Task's moves between states, each saved with the Task's change, for its record. A Task kept
 * from before these were has no row for its creation (`from_state` null).
 */
export const taskStateChanges = pgTable(
  "task_state_changes",
  {
    /** In the order they were saved: one Task's changes are saved one at a time, its row held. */
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id),
    fromState: text("from_state").$type<TaskState>(),
    toState: text("to_state").$type<TaskState>().notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull(),
    changedBy: jsonb("changed_by").$type<StateChangeCauseRow>().notNull(),
  },
  (table) => [index("task_state_changes_task").on(table.taskId)],
);

/**
 * Each Attachment belongs to one Idea, Initiative or Task; a link has a URL, a file a media type
 * and size.
 */
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey(),
    ideaId: uuid("idea_id").references(() => ideas.id),
    initiativeId: uuid("initiative_id").references(() => initiatives.id),
    taskId: uuid("task_id").references(() => tasks.id),
    /** An image sent in a message of a Thread on no Task or Initiative; threads are Conversations'. */
    threadId: uuid("thread_id"),
    kind: text("kind").$type<AttachmentKind>().notNull(),
    name: text("name").notNull(),
    url: text("url"),
    mediaType: text("media_type"),
    size: integer("size"),
    /**
     * Whether a file is a text file; null for a link, and for a file attached before The Office
     * judged it, until the start judges it (`AttachmentService.judgeFilesAttachedBefore`).
     */
    text: boolean("text"),
    /** Relative to the Task's worktree; null for a link, the user's uploads and older files. */
    sourcePath: text("source_path"),
    addedBy: jsonb("added_by").$type<AuthorRow>().notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("attachments_idea").on(table.ideaId),
    index("attachments_initiative").on(table.initiativeId),
    index("attachments_task").on(table.taskId),
    index("attachments_thread").on(table.threadId),
    check(
      "attachments_one_owner",
      sql`num_nonnulls(${table.ideaId}, ${table.initiativeId}, ${table.taskId}, ${table.threadId}) = 1`,
    ),
    check(
      "attachments_link_or_file",
      sql`case when ${table.kind} = 'link'
        then ${table.url} is not null and num_nulls(${table.mediaType}, ${table.size}) = 2
        else ${table.url} is null and num_nonnulls(${table.mediaType}, ${table.size}) = 2 end`,
    ),
  ],
);

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

/**
 * A document Attachment's text, read when it is added, for the search. Kept apart from
 * `attachments`, so listing Attachments never reads it, and keyed by the Attachment alone, so
 * it stays when the Attachment moves to another owner.
 */
export const attachmentTexts = pgTable("attachment_texts", {
  attachmentId: uuid("attachment_id")
    .primaryKey()
    .references(() => attachments.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  /** Parsed once as it is stored: a document's text is long, unlike any other searched field. */
  searchVector: tsvector("search_vector")
    .notNull()
    .generatedAlwaysAs((): SQL => searchVectorOf(attachmentTexts.text)),
});
