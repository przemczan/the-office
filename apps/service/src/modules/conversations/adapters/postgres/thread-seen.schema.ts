import { pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { threadMessages, threads } from "./threads.schema.js";

/**
 * The last message the user has seen in each chat Thread (spec §2.4). A Thread missing here has been
 * seen by nobody yet, as a new one; Threads on Tasks and Initiatives never have a row.
 */
export const threadSeen = pgTable("thread_seen", {
  threadId: uuid("thread_id")
    .primaryKey()
    .references(() => threads.id, { onDelete: "cascade" }),
  messageId: uuid("message_id")
    .notNull()
    .references(() => threadMessages.id, { onDelete: "cascade" }),
  seenAt: timestamp("seen_at", { withTimezone: true }).notNull(),
});
