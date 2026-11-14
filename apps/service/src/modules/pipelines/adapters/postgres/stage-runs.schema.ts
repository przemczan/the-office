import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { StageCommandRun } from "../../domain/stage-command-run.js";
import type {
  CarriedFailure,
  GateAction,
  SentBack,
  PublishedWork,
  StageOutcome,
  StageRunDecision,
  StageSessionMove,
  StageTokens,
  AskedInterruption,
} from "../../domain/stage-run.js";

/** Each run of a started Task's Stages; the number keeps one walk per Task. */
export const stageRuns = pgTable(
  "stage_runs",
  {
    id: uuid("id").primaryKey(),
    taskId: uuid("task_id").notNull(),
    stageKey: text("stage_key").notNull(),
    number: integer("number").notNull(),
    carriedFailure: jsonb("carried_failure").$type<CarriedFailure>(),
    /** The feedback a Gate sent the work back to this Stage with. */
    sentBack: jsonb("sent_back").$type<SentBack>(),
    /** The Stage Thread an Agent Stage's run works in. */
    threadId: uuid("thread_id"),
    /** How the run's session began. */
    session: text("session").$type<StageSessionMove>(),
    /**
     * What the run's session ran on: the engine's id and its name at the time, and the model; null
     * for runs kept before it was recorded.
     */
    engineId: text("engine_id"),
    engineName: text("engine_name"),
    model: text("model"),
    /** Where The Office left the Task's branch after the run. */
    headCommit: text("head_commit"),
    /** The Project commands The Office ran for the run. */
    commandRuns: jsonb("command_runs").$type<readonly StageCommandRun[]>().notNull().default([]),
    /**
     * Each command's whole output, in the order of `commandRuns`. Apart from them so the walk, which
     * reads every run at each move, doesn't load up to 64 KB a command.
     */
    commandOutputs: jsonb("command_outputs").$type<readonly string[]>().notNull().default([]),
    /** The run's engine calls' tokens. */
    tokens: jsonb("tokens")
      .$type<StageTokens>()
      .notNull()
      .default({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }),
    /** The Decisions the walk opened on the run, with the user's answers. */
    decisions: jsonb("decisions").$type<readonly StageRunDecision[]>().notNull().default([]),
    /** What the user asked of the run while it ran: pause or stop. */
    heldBy: text("held_by").$type<AskedInterruption>(),
    /** What the user did at a Gate's run. */
    gateAction: jsonb("gate_action").$type<GateAction>(),
    outcome: jsonb("outcome").$type<StageOutcome>(),
    /** What a Publish run shipped, kept before its after publishing line runs. */
    published: jsonb("published").$type<PublishedWork>(),
    /** Since when a Script Stage's run waits for a free run environment. */
    waitingSince: timestamp("waiting_since", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("stage_runs_task_number").on(table.taskId, table.number)],
);
