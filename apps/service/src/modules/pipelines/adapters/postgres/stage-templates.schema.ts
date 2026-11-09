import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import type { Stage } from "../../domain/stage.js";

/** The library's Stage templates; its migration seeds the built-ins, in `builtInStageTemplates`' order. */
export const stageTemplates = pgTable(
  "stage_templates",
  {
    id: text("id").primaryKey(),
    stage: jsonb("stage").$type<Stage>().notNull(),
    /** The library's order: the order the templates were added in. */
    position: integer("position").generatedAlwaysAsIdentity(),
  },
  (table) => [uniqueIndex("stage_templates_name").on(sql`lower(${table.stage}->>'name')`)],
);
