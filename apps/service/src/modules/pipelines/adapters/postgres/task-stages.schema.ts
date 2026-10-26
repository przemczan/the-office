import { boolean, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { Stage } from "../../domain/stage.js";
import type { TaskTrace } from "../../domain/task-stages.js";

/** Each Task's own Stages, keyed by the Task's id in Work. */
export const taskStages = pgTable("task_stages", {
  taskId: uuid("task_id").primaryKey(),
  pipelineId: text("pipeline_id").notNull(),
  stages: jsonb("stages").$type<readonly Stage[]>().notNull(),
  madeAt: timestamp("made_at", { withTimezone: true }).notNull(),
  editedForTask: boolean("edited_for_task").notNull().default(false),
  /** The trace every walk of the Task's Stages joins. */
  trace: jsonb("trace").$type<TaskTrace>(),
});
