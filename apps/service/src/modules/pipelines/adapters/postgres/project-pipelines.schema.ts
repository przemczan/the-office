import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { StageChange } from "../../domain/stage-change.js";
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
    /**
     * Legacy, kept for the previous release to read (migration `0205`): the office-wide Pipeline it
     * was built on, or for a later copy the one at the root of its copies. Read only by the move.
     */
    basePipelineId: text("base_pipeline_id").notNull(),
    /** Legacy alike: its Stage changes, `[]` for a copy. Read only by the move. */
    stageChanges: jsonb("stage_changes").$type<readonly StageChange[]>().notNull(),
    /** Its own flow; null until the move at start gave a legacy row the flow it builds. */
    stages: jsonb("stages").$type<readonly Stage[]>(),
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
