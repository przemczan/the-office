import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Unused since Activity stopped tracking what each user has seen. Kept in the schema so no migration
 * drops it: the release before still reads it, so it is dropped in a later release.
 */
export const activitySeen = pgTable(
  "activity_seen",
  {
    userId: text("user_id").notNull(),
    itemId: text("item_id").notNull(),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.itemId] }),
    index("activity_seen_seen_at_idx").on(table.seenAt),
  ],
);
