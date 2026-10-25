import { bigserial, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { MessageDraft } from "../../domain/message.js";
import type { ContextOverride, ThreadState, TokenTotals } from "../../domain/thread.js";

/** The engine session behind a Thread now, as kept. */
export interface ThreadSessionRow {
  readonly id: string;
  readonly roleKey: string;
  readonly cardVersion: number;
  readonly startedAt: string;
  readonly lastCallAt: string | null;
  readonly contextTokens: number;
  readonly startContextTokens: number | null;
  readonly full: boolean;
}

/** Each Thread, keyed by its home: `chat` with the Role's key, or `task` with the Task's id. */
export const threads = pgTable(
  "threads",
  {
    id: uuid("id").primaryKey(),
    homeKind: text("home_kind").$type<"chat" | "task">().notNull(),
    homeId: text("home_id").notNull(),
    roleKey: text("role_key").notNull(),
    title: text("title"),
    state: text("state").$type<ThreadState>().notNull(),
    session: jsonb("session").$type<ThreadSessionRow>(),
    override: text("override").$type<ContextOverride>(),
    tokens: jsonb("tokens").$type<TokenTotals>().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("threads_home").on(table.homeKind, table.homeId)],
);

/** The Office's log of each Thread; `position` orders it. */
export const threadMessages = pgTable(
  "thread_messages",
  {
    id: uuid("id").primaryKey(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    position: bigserial("position", { mode: "number" }).notNull(),
    /** Its kind and fields; its id, Thread and time have columns. */
    body: jsonb("body").$type<MessageDraft>().notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (table) => [index("thread_messages_thread").on(table.threadId, table.position)],
);
