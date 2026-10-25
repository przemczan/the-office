import { sql } from "drizzle-orm";
import {
  check,
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
import type { Priority, TaskState } from "../../domain/task.js";

// The three tables are in one file because Ideas and Tasks name each other.

export const ideas = pgTable("ideas", {
  id: uuid("id").primaryKey(),
  title: text("title").notNull(),
  notes: text("notes").notNull(),
  /** Null for an Idea captured Office-wide. */
  projectId: text("project_id"),
  state: text("state").$type<IdeaState>().notNull(),
  taskId: uuid("task_id").references((): AnyPgColumn => tasks.id),
  capturedBy: jsonb("captured_by").$type<Author>().notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  droppedAt: timestamp("dropped_at", { withTimezone: true }),
});

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey(),
    title: text("title").notNull(),
    projectId: text("project_id").notNull(),
    state: text("state").$type<TaskState>().notNull(),
    priority: text("priority").$type<Priority>().notNull(),
    /** Compared in code as plain strings; never sorted by Postgres, whose collation differs. */
    order: text("order_key").notNull(),
    plan: text("plan").notNull(),
    definitionOfDone: text("definition_of_done")
      .array()
      .notNull()
      .default(sql`'{}'`),
    pipelineId: text("pipeline_id").notNull(),
    originIdeaId: uuid("origin_idea_id").references((): AnyPgColumn => ideas.id),
    createdBy: jsonb("created_by").$type<Author>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("tasks_order_key").on(table.order)],
);

/** Each Attachment belongs to one Idea or one Task; a link has a URL, a file a media type and size. */
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey(),
    ideaId: uuid("idea_id").references(() => ideas.id),
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
    index("attachments_task").on(table.taskId),
    check("attachments_one_owner", sql`num_nonnulls(${table.ideaId}, ${table.taskId}) = 1`),
    check(
      "attachments_link_or_file",
      sql`case when ${table.kind} = 'link'
        then ${table.url} is not null and num_nulls(${table.mediaType}, ${table.size}) = 2
        else ${table.url} is null and num_nonnulls(${table.mediaType}, ${table.size}) = 2 end`,
    ),
  ],
);
