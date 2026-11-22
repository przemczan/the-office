import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { TestTargetsChatAsker } from "../../domain/test-targets-chat.js";
import { projects } from "./projects.schema.js";

/**
 * Each chat Thread a Project's page asked to set up its test targets in (spec §2.12), the newest
 * the one it follows; the Thread is Conversations', named by its id alone.
 */
export const testTargetsChats = pgTable(
  "test_targets_chats",
  {
    threadId: uuid("thread_id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    roleKey: text("role_key").notNull(),
    askedBy: jsonb("asked_by").$type<TestTargetsChatAsker>().notNull(),
    askedAt: timestamp("asked_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("test_targets_chats_project_asked_at").on(table.projectId, table.askedAt)],
);
