import { sql } from "drizzle-orm";
import { check, integer, pgTable, smallint } from "drizzle-orm/pg-core";

/**
 * The Office settings Conversations reads, in one row once Settings saves them; until then the
 * repository answers each default.
 */
export const conversationsSettings = pgTable(
  "conversations_settings",
  {
    id: smallint("id").primaryKey().default(1),
    sizeThreshold: integer("size_threshold").notNull(),
  },
  (table) => [
    check("conversations_settings_one_row", sql`${table.id} = 1`),
    check("conversations_settings_size_threshold", sql`${table.sizeThreshold} > 0`),
  ],
);
