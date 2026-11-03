import { pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { threads } from "./threads.schema.js";

/**
 * The Caretaker Threads the user allowed changes in (spec §2.4): a Thread missing here only reads,
 * as every new one does.
 */
export const changesAllowed = pgTable("changes_allowed", {
  threadId: uuid("thread_id")
    .primaryKey()
    .references(() => threads.id, { onDelete: "cascade" }),
  allowedAt: timestamp("allowed_at", { withTimezone: true }).notNull(),
});
