import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { Stage } from "../../domain/stage.js";

/** Each started Task's own Stages, keyed by the Task's id in Work. */
export const taskStages = pgTable("task_stages", {
  taskId: uuid("task_id").primaryKey(),
  pipelineId: text("pipeline_id").notNull(),
  stages: jsonb("stages").$type<readonly Stage[]>().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
});
