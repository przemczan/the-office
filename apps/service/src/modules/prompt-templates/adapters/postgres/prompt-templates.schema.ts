import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import type { UserRef } from "../../domain/user.js";

/** Every version of each Prompt template's text; a null text is its default. */
export const promptTemplateVersions = pgTable(
  "prompt_template_versions",
  {
    key: text("key").notNull(),
    version: integer("version").notNull(),
    text: text("text"),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull(),
    savedBy: jsonb("saved_by").$type<UserRef>().notNull(),
  },
  // Version 0 is never saved: it means none.
  (table) => [
    primaryKey({ columns: [table.key, table.version] }),
    check("prompt_template_versions_version", sql`${table.version} > 0`),
  ],
);
