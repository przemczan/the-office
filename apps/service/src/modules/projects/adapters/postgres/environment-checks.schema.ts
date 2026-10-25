import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { Check, EnvironmentCheckState } from "../../domain/environment-check.js";
import type { ProjectEnvironment } from "../../domain/project-environment.js";
import { projects } from "./projects.schema.js";

/** Each Project's last finished environment check. */
export const environmentChecks = pgTable("environment_checks", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  environment: jsonb("environment").$type<ProjectEnvironment>().notNull(),
  state: text("state").$type<Exclude<EnvironmentCheckState, "running">>().notNull(),
  checks: jsonb("checks").$type<Check[]>().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
});
