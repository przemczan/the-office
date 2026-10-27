import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { DecisionAnswer, PassedOn, Recommendation } from "../../domain/decision.js";
import type { MessageDraft } from "../../domain/message.js";
import type { ProposalStatus, ProposedChange } from "../../domain/proposal.js";
import type {
  Consultation,
  ContextOverride,
  ThreadState,
  TokenTotals,
} from "../../domain/thread.js";

/** A Consultant's passing a Decision on, as kept. */
export type SavedPassedOn = Omit<PassedOn, "passedOnAt"> & { readonly passedOnAt: string };

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
    runningTurnTokens: jsonb("running_turn_tokens")
      .$type<TokenTotals>()
      .notNull()
      .default({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    stageThread: boolean("stage_thread").notNull().default(false),
    /** Set for a Consultation: the Decision it answers and the Agent who asked it. */
    consultation: jsonb("consultation").$type<Consultation>(),
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

/**
 * The Decisions opened in each Thread on a Task; one per Thread waits on the user at a time. The
 * Task's id is the Thread's home, kept here for the Task's Brief.
 */
export const decisions = pgTable(
  "decisions",
  {
    id: uuid("id").primaryKey(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    taskId: text("task_id").notNull(),
    /** Null when The Office asked. */
    roleKey: text("role_key"),
    question: text("question").notNull(),
    context: text("context").notNull(),
    options: jsonb("options").$type<readonly string[]>().notNull(),
    recommendation: jsonb("recommendation").$type<Recommendation>().notNull(),
    askedAt: timestamp("asked_at", { withTimezone: true }).notNull(),
    /** The Consultant's Role key while the Decision waits on them; null when it waits on the user. */
    putTo: text("put_to"),
    /** The Consultants who passed it on, the first one first; `passedOnAt` as an ISO time. */
    passedOn: jsonb("passed_on").$type<readonly SavedPassedOn[]>().notNull().default([]),
    answer: jsonb("answer").$type<DecisionAnswer & { answeredBy?: string }>(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    /** When an approval this answer gave a held call let it through; null while it is unused. */
    approvalSpentAt: timestamp("approval_spent_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("decisions_open_in_thread")
      .on(table.threadId)
      .where(sql`${table.answeredAt} is null`),
    index("decisions_task").on(table.taskId, table.answeredAt),
  ],
);

/** The Proposals drafted in each Thread, open until the user applies or declines them. */
export const proposals = pgTable(
  "proposals",
  {
    id: uuid("id").primaryKey(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    /** The key of the drafter's Role. */
    draftedBy: text("drafted_by").notNull(),
    draftedAt: timestamp("drafted_at", { withTimezone: true }).notNull(),
    /** What it changes, by kind: as drafted while open, as applied once applied. */
    change: jsonb("change").$type<ProposedChange>().notNull(),
    status: text("status").$type<ProposalStatus["kind"]>().notNull(),
    /** When the user applied or declined it; null while it is open. */
    statusAt: timestamp("status_at", { withTimezone: true }),
  },
  (table) => [index("proposals_thread").on(table.threadId, table.draftedAt)],
);
