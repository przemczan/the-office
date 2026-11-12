import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import type { StageChange } from "../../domain/stage-change.js";
import { pipelines } from "./pipelines.schema.js";

/**
 * The Project Pipelines, each its Project's, built from an office-wide base Pipeline. `project_id`
 * has no foreign key: no module reads another's tables (spec §5.3), so the name rule spanning both
 * tables is checked in the application, under the library's lock.
 */
export const projectPipelines = pgTable(
  "project_pipelines",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    /** Removing a base Pipeline is refused while one is built from it; the key backs that up. */
    basePipelineId: text("base_pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "restrict" }),
    stageChanges: jsonb("stage_changes").$type<readonly StageChange[]>().notNull(),
    /** The order they were added in. */
    position: integer("position").generatedAlwaysAsIdentity(),
  },
  (table) => [uniqueIndex("project_pipelines_name").on(table.projectId, sql`lower(${table.name})`)],
);
