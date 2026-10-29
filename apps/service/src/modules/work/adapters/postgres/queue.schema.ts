import { sql } from "drizzle-orm";
import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tasks } from "./work.schema.js";

/**
 * The one Office-wide queue for Start: a row per queued Task. Every write holds Starts, so places
 * stay distinct without an index that Move up's swap would trip over.
 */
export const queue = pgTable("queue", {
  taskId: uuid("task_id")
    .primaryKey()
    .references(() => tasks.id),
  place: integer("place").notNull(),
  queuedAt: timestamp("queued_at", { withTimezone: true }).notNull(),
  reasons: text("reasons")
    .array()
    .notNull()
    .default(sql`'{}'`),
  /** The Tasks it was queued behind for an Overlap; a Task is dropped, never deleted, so ids hold. */
  behind: uuid("behind")
    .array()
    .notNull()
    .default(sql`'{}'`),
});
