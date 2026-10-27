import { pgTable, uuid } from "drizzle-orm/pg-core";

/** The Decision each Task paused for lack of people waits on, keyed by the Task's id in Work. */
export const staffingHolds = pgTable("staffing_holds", {
  taskId: uuid("task_id").primaryKey(),
  decisionId: uuid("decision_id").notNull(),
});
