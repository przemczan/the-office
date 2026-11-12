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
import type { Author } from "../../domain/author.js";
import type { IdeaState } from "../../domain/idea.js";
import type { InitiativeState } from "../../domain/initiative.js";
import type { StateChangeCause } from "../../domain/state-change.js";
import type {
  Priority,
  ProposedPipeline,
  TaskHolder,
  TaskMadeFor,
  TaskState,
} from "../../domain/task.js";
import { searchVectorOf } from "./search-vector.js";

// The tables are in one file because Ideas, Initiatives and Tasks name each other.

/** A Task's Move to another Project as jsonb keeps it: its time as an ISO string. */
export interface ProjectMoveRow {
  readonly from: string;
  readonly to: string;
  readonly at: string;
  readonly by: Author;
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
  capturedBy: jsonb("captured_by").$type<Author>().notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  droppedAt: timestamp("dropped_at", { withTimezone: true }),
});

/** The Initiative's branch in one Project as jsonb keeps it: its time as an ISO string. */
export interface InitiativeBranchRow {
  readonly projectId: string;
  readonly madeAt: string;
}

/** Its Tasks name it; the Projects it spans are theirs. */
export const initiatives = pgTable(
  "initiatives",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    outcome: text("outcome").notNull(),
    state: text("state").$type<InitiativeState>().notNull(),
    originIdeaId: uuid("origin_idea_id")
      .notNull()
      .references((): AnyPgColumn => ideas.id),
    createdBy: jsonb("created_by").$type<Author>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    /** Null while it is shaping or active, and for one that ended before this was kept. */
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** Null while it isn't archived. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /** Null until it is first restored from the Archive. */
    restoredAt: timestamp("restored_at", { withTimezone: true }),
    /** Null while it isn't paused. */
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    /** Its latest planning Thread, kept by Conversations; null until it is first planned. */
    planningThreadId: uuid("planning_thread_id"),
    planningAutoMode: boolean("planning_auto_mode").notNull().default(false),
    /** The Initiative's Pipeline; null for None, which every Initiative from before it has. */
    pipelineId: text("pipeline_id"),
    /** Null while it has no Pipeline; unique among those that have one, whatever their state. */
    shortName: text("short_name"),
    /** The Projects its branch was made in, oldest first; kept after a Drop, as the branches are. */
    branches: jsonb("branches")
      .$type<InitiativeBranchRow[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
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
    /** Compared in code as plain strings; never sorted by Postgres, whose collation differs. */
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
    /** Null unless the fire alarm or its Initiative's Pause holds it Paused. */
    pausedBy: text("paused_by").$type<TaskHolder>(),
    /** Null for a Task the user or an Agent made. */
    madeFor: text("made_for").$type<TaskMadeFor>(),
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
    createdBy: jsonb("created_by").$type<Author>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    /** Null while it isn't archived. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /** Null until it is first restored from the Archive. */
    restoredAt: timestamp("restored_at", { withTimezone: true }),
    /** Null while it hasn't ended, and for one whose end was never recorded. */
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("tasks_order_key").on(table.order),
    index("tasks_initiative").on(table.initiativeId),
    // A Project has one Onboard Task at most: its onboarding is read from it alone.
    uniqueIndex("tasks_onboard_task_per_project")
      .on(table.projectId)
      .where(sql`${table.madeFor} = 'onboard'`),
    // And one open "Set up the run environment" Task, which asking again answers.
    uniqueIndex("tasks_open_run_environment_set_up_per_project")
      .on(table.projectId)
      .where(
        sql`${table.madeFor} = 'run-environment-setup' AND ${table.state} NOT IN ('done', 'dropped')`,
      ),
    // And one unfinished Publishing Task per Initiative there, which two done checks racing meet.
    uniqueIndex("tasks_open_publishing_task_per_project")
      .on(table.initiativeId, table.projectId)
      .where(sql`${table.madeFor} = 'publishing' AND ${table.state} NOT IN ('done', 'dropped')`),
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
    changedBy: jsonb("changed_by").$type<StateChangeCause>().notNull(),
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
    addedBy: jsonb("added_by").$type<Author>().notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("attachments_idea").on(table.ideaId),
    index("attachments_initiative").on(table.initiativeId),
    index("attachments_task").on(table.taskId),
    check(
      "attachments_one_owner",
      sql`num_nonnulls(${table.ideaId}, ${table.initiativeId}, ${table.taskId}) = 1`,
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
