import { integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import type { TestTargetKind, TestTargetSetBy } from "../../domain/test-target.js";
import type { StoredTestTargetSettings } from "./stored-test-target.js";
import { projects } from "./projects.schema.js";

/**
 * Each Project's test targets (spec §2.12), kept here only, never in a repository; `settings` holds
 * the kind's own fields, Secret variables with their values as the Project's environment keeps
 * them, and `set_by` who set each field last.
 */
export const testTargets = pgTable(
  "test_targets",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    kind: text("kind").$type<TestTargetKind>().notNull(),
    settings: jsonb("settings").$type<StoredTestTargetSettings>().notNull(),
    setBy: jsonb("set_by").$type<TestTargetSetBy>().notNull(),
    position: integer("position").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.key] })],
);
