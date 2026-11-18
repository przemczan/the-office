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
import type { EngineId } from "../../../engine/index.js";
import type {
  AnswerGivenBy,
  DecisionAnswer,
  DecisionQuestion,
  OneQuestionAnswer,
  OneQuestionKind,
  PassedOn,
  Recommendation,
} from "../../domain/decision.js";
import type { MessageDraft } from "../../domain/message.js";
import type { ProposalStatus, ProposedChange } from "../../domain/proposal.js";
import type {
  Consultation,
  ContextOverride,
  Home,
  ThreadState,
  TokenTotals,
} from "../../domain/thread.js";
import type { UserRef } from "../../domain/user.js";

/** A Consultant's passing a Decision on, as kept. */
export type SavedPassedOn = Omit<PassedOn, "passedOnAt"> & { readonly passedOnAt: string };

/**
 * A message as kept: a Decision's answer line keeps the answer as one (`answer`, which the release
 * before the form reads) beside the form's answer (`formAnswer`, absent on lines kept before it).
 */
export type SavedMessage =
  Exclude<MessageDraft, { readonly kind: "decision-answer" }> | SavedDecisionAnswerLine;

/** A Decision's answer line as kept. */
export type SavedDecisionAnswerLine = Omit<
  Extract<MessageDraft, { readonly kind: "decision-answer" }>,
  "answer"
> & {
  readonly answer: OneQuestionAnswer;
  readonly formAnswer?: DecisionAnswer;
};

/** The engine session behind a Thread now, as kept. */
export interface ThreadSessionRow {
  readonly id: string;
  readonly roleKey: string;
  readonly cardVersion: number;
  readonly engineId: EngineId;
  readonly startedAt: string;
  readonly lastCallAt: string | null;
  readonly contextTokens: number;
  /** Absent before the first reading, and on sessions saved before the window was kept. */
  readonly contextWindow?: number;
  readonly startContextTokens: number | null;
  readonly full: boolean;
  /** Absent on sessions saved before Allow changes: none had changes allowed. */
  readonly changesAllowed?: boolean;
  /** Absent on sessions saved before the Office instructions: they resume with none. */
  readonly officeInstructionsVersion?: number;
  /** Absent on sessions saved before duties, which they never decided. */
  readonly heldDuties?: readonly string[];
  /** Absent on the cascade's own engine, and on sessions saved before Stand-in Engines. */
  readonly standInFor?: {
    readonly engineId: EngineId;
    readonly engineName: string;
    readonly reason: string;
  };
}

/**
 * Each Thread, keyed by its home: `chat` with the Role's key, `task` with the Task's id, or
 * `initiative` with the Initiative's.
 */
export const threads = pgTable(
  "threads",
  {
    id: uuid("id").primaryKey(),
    homeKind: text("home_kind").$type<Home["kind"]>().notNull(),
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
  (table) => [
    index("threads_home").on(table.homeKind, table.homeId),
    // A person's chat and their Threads on Tasks are read a page at a time, the newest first.
    index("threads_person_newest").on(
      table.homeKind,
      table.roleKey,
      table.startedAt.desc(),
      table.id.desc(),
    ),
  ],
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
    body: jsonb("body").$type<SavedMessage>().notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("thread_messages_thread").on(table.threadId, table.position),
    // `read_threads` reads the log by when its messages were logged, across Threads.
    index("thread_messages_at").on(table.at),
  ],
);

/**
 * The Decisions opened in each Thread, each on a Task: the Thread's home in a Thread on a Task, one
 * of the Initiative's Tasks in its planning Thread; a call made from a chat is on none. One per
 * Thread and Task waits at a time, which in a Thread on a Task is one per Thread, and one per chat
 * Thread.
 */
export const decisions = pgTable(
  "decisions",
  {
    id: uuid("id").primaryKey(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    /** Null for a call made from a chat. */
    taskId: text("task_id"),
    /** The kind as one question: a form is kept as `question`, which the release before reads. */
    kind: text("kind").$type<OneQuestionKind>().notNull(),
    /** Null when The Office asked. */
    roleKey: text("role_key"),
    /** The first question, its options and recommendation: the form as one, for the release before. */
    question: text("question").notNull(),
    context: text("context").notNull(),
    options: jsonb("options").$type<readonly string[]>().notNull(),
    recommendation: jsonb("recommendation").$type<Recommendation>().notNull(),
    /** The form's questions, in order; null on a Decision kept before the form, read as one. */
    questions: jsonb("questions").$type<readonly DecisionQuestion[]>(),
    askedAt: timestamp("asked_at", { withTimezone: true }).notNull(),
    /** The Task's Attachments it is about; Work keeps them, so no foreign key holds them. */
    attachmentIds: jsonb("attachment_ids").$type<readonly string[]>().notNull().default([]),
    /** The Consultant's Role key while the Decision waits on them; null when it waits on the user. */
    putTo: text("put_to"),
    /** The Consultants who passed it on, the first one first; `passedOnAt` as an ISO time. */
    passedOn: jsonb("passed_on").$type<readonly SavedPassedOn[]>().notNull().default([]),
    /** The answer as one, for the release before, with who gave it. */
    answer: jsonb("answer").$type<OneQuestionAnswer & AnswerGivenBy>(),
    /** The form's answer; null while unanswered, and on a Decision answered before the form. */
    formAnswer: jsonb("form_answer").$type<DecisionAnswer>(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    /** When it was closed unanswered, as its Task was dropped; null otherwise. */
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** When an approval this answer gave a held call let it through; null while it is unused. */
    approvalSpentAt: timestamp("approval_spent_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("decisions_open_on_task_in_thread")
      .on(table.threadId, table.taskId)
      .where(sql`${table.answeredAt} is null and ${table.closedAt} is null`),
    // Nulls are distinct to the index above, so a chat Thread's one open call needs its own.
    uniqueIndex("decisions_open_on_no_task_in_thread")
      .on(table.threadId)
      .where(
        sql`${table.answeredAt} is null and ${table.closedAt} is null and ${table.taskId} is null`,
      ),
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
    /**
     * The user who applied or declined it; null while it is open, and on one from before users
     * existed until the first user claims it.
     */
    statusBy: jsonb("status_by").$type<UserRef>(),
  },
  (table) => [index("proposals_thread").on(table.threadId, table.draftedAt)],
);
