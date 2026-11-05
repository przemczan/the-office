import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Every version of the Office instructions, kept for the sessions that started with it. */
export const officeInstructionsVersions = pgTable(
  "office_instructions_versions",
  {
    version: integer("version").primaryKey(),
    text: text("text").notNull(),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull(),
  },
  // Version 0 is never saved: it means none.
  (table) => [check("office_instructions_versions_version", sql`${table.version} > 0`)],
);
