import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import type { IssueImportedBy, IssueWriteBackAction } from "../../domain/issue-link.js";

/**
 * The issues imported as Tasks, one row per issue on its remote, never deleted: the unique remote
 * and number import each issue once. The Task is named by id alone, as Work keeps it.
 */
export const issueLinks = pgTable(
  "issue_links",
  {
    id: uuid("id").primaryKey(),
    projectId: text("project_id").notNull(),
    /** The repository, as git resolves the base branch's remote, as `pull_requests.remote_url` is. */
    remoteUrl: text("remote_url").notNull(),
    number: integer("number").notNull(),
    /** Null only while the import claims the issue, before its Task is made. */
    taskId: uuid("task_id"),
    title: text("title").notNull(),
    url: text("url").notNull(),
    authorLogin: text("author_login").notNull(),
    authorUrl: text("author_url").notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull(),
    importedBy: jsonb("imported_by").$type<IssueImportedBy>().notNull(),
    closedOnHostAt: timestamp("closed_on_host_at", { withTimezone: true }),
    /** When the Task became Done or Dropped: watching the issue stops. */
    taskEndedAt: timestamp("task_ended_at", { withTimezone: true }),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
  },
  (table) => [
    unique("issue_links_remote_url_number_unique").on(table.remoteUrl, table.number),
    index("issue_links_task_idx").on(table.taskId),
  ],
);

/** An outbox of what to write on an issue: what the code host refused is retried. */
export const issueWriteBacks = pgTable("issue_write_backs", {
  id: uuid("id").primaryKey(),
  issueLinkId: uuid("issue_link_id")
    .notNull()
    .references(() => issueLinks.id),
  action: text("action").$type<IssueWriteBackAction>().notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  /** Null until the code host took it. */
  doneAt: timestamp("done_at", { withTimezone: true }),
  tries: integer("tries").notNull().default(0),
  /** Why the code host last refused it; null while it hasn't. */
  lastProblem: text("last_problem"),
});
