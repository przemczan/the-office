import { boolean, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import type { ActionKind, ActionSetBy } from "../../domain/action.js";
import { projects } from "./projects.schema.js";
import type { StoredActionSettings } from "./stored-action.js";

/**
 * Each Project's Actions (spec §2.15), kept here only, never in a repository; `settings` holds the
 * kind's own values, so a later one (such as a device) needs no migration, and `set_by` who set
 * each value last.
 */
export const actions = pgTable(
  "actions",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    position: integer("position").notNull(),
    name: text("name").notNull(),
    kind: text("kind").$type<ActionKind>().notNull(),
    settings: jsonb("settings").$type<StoredActionSettings>().notNull(),
    leavesTheWorkstation: boolean("leaves_the_workstation").notNull(),
    setBy: jsonb("set_by").$type<ActionSetBy>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.key] })],
);
