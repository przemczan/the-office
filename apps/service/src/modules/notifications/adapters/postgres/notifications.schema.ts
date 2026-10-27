import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { TaskOutcomeKind } from "../../domain/task-outcome.js";

/** Each outcome of a started Task, as it happened. */
export const taskOutcomes = pgTable(
  "task_outcomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id").notNull(),
    outcome: text("outcome").$type<TaskOutcomeKind>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("task_outcomes_occurred_at").on(table.occurredAt)],
);

/** The user's activity, in one row once they are first seen. */
export const userActivity = pgTable(
  "user_activity",
  {
    id: smallint("id").primaryKey().default(1),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull(),
    leftAt: timestamp("left_at", { withTimezone: true }).notNull(),
  },
  (table) => [check("user_activity_one_row", sql`${table.id} = 1`)],
);

/** Each Thread's tokens so far at its last count, which the next count is measured from. */
export const threadTokenCounts = pgTable("thread_token_counts", {
  threadId: uuid("thread_id").primaryKey(),
  tokens: bigint("tokens", { mode: "number" }).notNull(),
});

/** The tokens counted on each day, all four kinds. */
export const dayTokens = pgTable("day_tokens", {
  day: date("day", { mode: "string" }).primaryKey(),
  tokens: bigint("tokens", { mode: "number" }).notNull(),
});

/** The Tasks with a Stage run on each day. */
export const tasksTouched = pgTable(
  "tasks_touched",
  {
    day: date("day", { mode: "string" }).notNull(),
    taskId: uuid("task_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.day, table.taskId] })],
);
