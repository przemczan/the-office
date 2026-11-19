import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  PullRequestChecks,
  PullRequestMergeable,
  PullRequestState,
} from "../../domain/pull-request.js";
import { projects } from "./projects.schema.js";

/**
 * The pull requests The Office opened, one row per pull request on its remote, kept after it is
 * merged or closed (`ended_at`). The Task is named by id alone, as its record may go first.
 */
export const pullRequests = pgTable(
  "pull_requests",
  {
    id: uuid("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").notNull(),
    remoteUrl: text("remote_url").notNull(),
    number: integer("number").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    branch: text("branch").notNull(),
    baseBranch: text("base_branch").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    state: text("state").$type<PullRequestState>().notNull(),
    checks: text("checks").$type<PullRequestChecks>().notNull(),
    mergeable: text("mergeable").$type<PullRequestMergeable>().notNull(),
    headCommit: text("head_commit"),
    baseCommit: text("base_commit"),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    stale: boolean("stale").notNull().default(false),
  },
  (table) => [
    unique("pull_requests_remote_url_number_unique").on(table.remoteUrl, table.number),
    index("pull_requests_project_id_idx").on(table.projectId),
  ],
);
