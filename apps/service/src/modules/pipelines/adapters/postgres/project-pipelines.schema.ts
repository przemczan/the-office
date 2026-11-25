import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { Stage } from "../../domain/stage.js";

/**
 * The Project Pipelines, each its Project's, with its own Stages. `project_id` has no foreign key:
 * no module reads another's tables (spec §5.3), so the name rule spanning both tables is checked in
 * the application, under the library's lock.
 */
export const projectPipelines = pgTable(
  "project_pipelines",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    stages: jsonb("stages").$type<readonly Stage[]>().notNull(),
    copiedFromName: text("copied_from_name"),
    /** Null for one the move made. */
    copiedAt: timestamp("copied_at", { withTimezone: true }),
    /** Why it was Broken as The Office moved it; null when it wasn't, or once it is saved. */
    brokenBeforeUpdate: jsonb("broken_before_update").$type<readonly string[]>(),
    /** The order they were added in. */
    position: integer("position").generatedAlwaysAsIdentity(),
  },
  (table) => [uniqueIndex("project_pipelines_name").on(table.projectId, sql`lower(${table.name})`)],
);
