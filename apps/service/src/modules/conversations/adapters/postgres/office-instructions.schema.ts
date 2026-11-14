import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { UserRef } from "../../domain/user.js";

/** Every version of the Office instructions, kept for the sessions that started with it. */
export const officeInstructionsVersions = pgTable(
  "office_instructions_versions",
  {
    version: integer("version").primaryKey(),
    text: text("text").notNull(),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull(),
    /** The user who saved it; null on a version from before users existed, until it is claimed. */
    savedBy: jsonb("saved_by").$type<UserRef>(),
  },
  // Version 0 is never saved: it means none.
  (table) => [check("office_instructions_versions_version", sql`${table.version} > 0`)],
);
