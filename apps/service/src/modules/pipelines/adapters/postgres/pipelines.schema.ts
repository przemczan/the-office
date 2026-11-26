import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import type { StagePosition } from "../../domain/route.js";
import type { Stage } from "../../domain/stage.js";

/** The Pipeline library; its migration seeds the built-ins, in `builtInPipelines`' order. */
export const pipelines = pgTable(
  "pipelines",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    stages: jsonb("stages").$type<readonly Stage[]>().notNull(),
    /** Where End stands on the canvas; null, right of the right-most Stage. */
    endPosition: jsonb("end_position").$type<StagePosition>(),
    /** The library's order: the order the Pipelines were added in. */
    position: integer("position").generatedAlwaysAsIdentity(),
  },
  (table) => [uniqueIndex("pipelines_name").on(sql`lower(${table.name})`)],
);
