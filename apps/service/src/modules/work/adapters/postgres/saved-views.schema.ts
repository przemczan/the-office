import { sql } from "drizzle-orm";
import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { BoardFilters } from "../../domain/saved-view.js";

/** The board's filters, saved under a name; it names no other record, so it has a file of its own. */
export const savedViews = pgTable(
  "saved_views",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    filters: jsonb("filters").$type<BoardFilters>().notNull(),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("saved_views_name").on(sql`lower(${table.name})`)],
);
