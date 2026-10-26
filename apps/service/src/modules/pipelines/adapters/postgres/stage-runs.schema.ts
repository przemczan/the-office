import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { CarriedFailure, StageOutcome } from "../../domain/stage-run.js";

/** Each run of a started Task's Stages; the number keeps one walk per Task. */
export const stageRuns = pgTable(
  "stage_runs",
  {
    id: uuid("id").primaryKey(),
    taskId: uuid("task_id").notNull(),
    stageKey: text("stage_key").notNull(),
    number: integer("number").notNull(),
    carriedFailure: jsonb("carried_failure").$type<CarriedFailure>(),
    outcome: jsonb("outcome").$type<StageOutcome>(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("stage_runs_task_number").on(table.taskId, table.number)],
);
