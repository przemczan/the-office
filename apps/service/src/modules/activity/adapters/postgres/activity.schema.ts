import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/** Each user's ended Activity items they have seen, by item id, forgotten after 30 days. */
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
