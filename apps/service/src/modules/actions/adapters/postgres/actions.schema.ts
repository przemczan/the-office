import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  ActionRunCiRun,
  ActionRunKind,
  ActionRunOutcome,
  ActionRunStopReason,
  ActionRunUser,
} from "../../domain/action-run.js";

/**
 * Each Action run (spec §2.15, "Action run"), kept with its log, the newest 20 of each Action. Its
 * Project, Task, Initiative and test instance are other modules' records, named by id alone.
 */
export const actionRuns = pgTable(
  "action_runs",
  {
    id: uuid("id").primaryKey(),
    projectId: text("project_id").notNull(),
    /** The Action's key, name and kind at its start. */
    actionKey: text("action_key").notNull(),
    actionName: text("action_name").notNull(),
    kind: text("kind").$type<ActionRunKind>().notNull(),
    /** Its state in its kind's own words. */
    state: text("state").notNull(),
    /** How it ended; null while it is running. */
    outcome: text("outcome").$type<ActionRunOutcome>(),
    /** What it ran from: `branch`, `task` or `initiative`, with the Task's or Initiative's id and name. */
    sourceKind: text("source_kind").$type<"branch" | "task" | "initiative">().notNull(),
    sourceId: uuid("source_id"),
    sourceName: text("source_name"),
    branch: text("branch").notNull(),
    /** The commit it ran; a Workflow run's as its CI run reports it, null until known. */
    commit: text("commit"),
    /** The commit the start's confirm step showed, or the tip fetched at the start. */
    startCommit: text("start_commit").notNull(),
    note: text("note"),
    startedBy: jsonb("started_by").$type<ActionRunUser>().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    exitCode: integer("exit_code"),
    endedBecause: text("ended_because"),
    stoppedBy: text("stopped_by").$type<ActionRunStopReason["kind"]>(),
    testInstanceId: uuid("test_instance_id"),
    workflowFile: text("workflow_file"),
    askedAt: timestamp("asked_at", { withTimezone: true }),
    ciRun: jsonb("ci_run").$type<ActionRunCiRun>(),
    workflowRunsUrl: text("workflow_runs_url"),
  },
  (table) => [
    index("action_runs_action").on(table.projectId, table.actionKey, table.startedAt),
    index("action_runs_test_instance").on(table.testInstanceId),
    // One run of each Action at a time (spec §2.15, "Limits").
    uniqueIndex("action_runs_one_running")
      .on(table.projectId, table.actionKey)
      .where(sql`${table.outcome} is null`),
    check("action_runs_kind", sql`${table.kind} in ('project-command', 'test-target', 'workflow')`),
    check(
      "action_runs_outcome",
      sql`${table.outcome} is null or ${table.outcome} in ('succeeded', 'failed', 'stopped')`,
    ),
    check("action_runs_source_kind", sql`${table.sourceKind} in ('branch', 'task', 'initiative')`),
  ],
);

/** Actions at once (spec §2.15, Defaults), in one row once Settings saves it. */
export const actionSettings = pgTable(
  "action_settings",
  {
    id: smallint("id").primaryKey().default(1),
    actionsAtOnce: integer("actions_at_once").notNull().default(2),
  },
  (table) => [
    check("action_settings_one_row", sql`${table.id} = 1`),
    check("action_settings_actions_at_once", sql`${table.actionsAtOnce} between 1 and 6`),
  ],
);
