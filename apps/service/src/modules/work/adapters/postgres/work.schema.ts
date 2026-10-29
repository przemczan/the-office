import { sql, type SQL } from "drizzle-orm";
import {
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
import type { Priority, ProposedPipeline, TaskState } from "../../domain/task.js";
import { searchVectorOf } from "./search-vector.js";

// The tables are in one file because Ideas, Initiatives and Tasks name each other.

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

/** Its Tasks name it; the Projects it spans are theirs. */
export const initiatives = pgTable("initiatives", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  outcome: text("outcome").notNull(),
  state: text("state").$type<InitiativeState>().notNull(),
  originIdeaId: uuid("origin_idea_id")
    .notNull()
    .references((): AnyPgColumn => ideas.id),
  createdBy: jsonb("created_by").$type<Author>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

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
    plan: text("plan").notNull(),
    planConfirmed: boolean("plan_confirmed").notNull().default(false),
    filesToChange: text("files_to_change")
      .array()
      .notNull()
      .default(sql`'{}'`),
    definitionOfDone: text("definition_of_done")
      .array()
      .notNull()
      .default(sql`'{}'`),
    definitionOfDoneConfirmed: boolean("definition_of_done_confirmed").notNull().default(false),
    pipelineId: text("pipeline_id").notNull(),
    /** Null while the Planner proposes none. */
    proposedPipeline: jsonb("proposed_pipeline").$type<ProposedPipeline>(),
    /** Null until the Task starts, and for a Pipeline without an Agent Stage. */
    personRole: text("person_role"),
    pausedByAlarm: boolean("paused_by_alarm").notNull().default(false),
    isOnboardTask: boolean("is_onboard_task").notNull().default(false),
    /** The Tasks it waits for, in the order added; a Task is dropped, never deleted, so ids hold. */
    blockedBy: uuid("blocked_by")
      .array()
      .notNull()
      .default(sql`'{}'`),
    originIdeaId: uuid("origin_idea_id").references((): AnyPgColumn => ideas.id),
    initiativeId: uuid("initiative_id").references((): AnyPgColumn => initiatives.id),
    createdBy: jsonb("created_by").$type<Author>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("tasks_order_key").on(table.order),
    index("tasks_initiative").on(table.initiativeId),
    // A Project has one Onboard Task at most: its onboarding is read from it alone.
    uniqueIndex("tasks_onboard_task_per_project")
      .on(table.projectId)
      .where(sql`${table.isOnboardTask}`),
  ],
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
