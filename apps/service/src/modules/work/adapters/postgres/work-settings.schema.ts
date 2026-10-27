import { sql } from "drizzle-orm";
import { check, integer, pgTable, smallint } from "drizzle-orm/pg-core";

/**
 * The Office settings Work reads, in one row once Settings saves them; until then the
 * repository answers each default.
 */
export const workSettings = pgTable(
  "work_settings",
  {
    id: smallint("id").primaryKey().default(1),
    officeWideLimit: integer("office_wide_limit").notNull(),
  },
  (table) => [
    check("work_settings_one_row", sql`${table.id} = 1`),
    check("work_settings_office_wide_limit", sql`${table.officeWideLimit} > 0`),
  ],
);
