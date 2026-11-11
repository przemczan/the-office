import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { Ending, SubAgentMessageDraft } from "../../domain/sub-agents-and-processes.js";
import { threads } from "./threads.schema.js";

/**
 * A session's Sub-agents and Processes (spec 2.9), one row each by its session and the call that
 * started it. The fields only one kind has are null for the other.
 */
export const subAgentsAndProcesses = pgTable(
  "sub_agents_and_processes",
  {
    sessionId: text("session_id").notNull(),
    callId: text("call_id").notNull(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"sub-agent" | "process">().notNull(),
    engineTaskId: text("engine_task_id"),
    startedBy: text("started_by"),
    description: text("description").notNull(),
    ending: jsonb("ending").$type<Ending>(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    revision: integer("revision").notNull(),
    lastSequence: integer("last_sequence").notNull().default(0),
    agentKind: text("agent_kind"),
    prompt: text("prompt"),
    background: boolean("background"),
    reportedBack: text("reported_back"),
    toolCallCount: integer("tool_call_count"),
    totalTokens: integer("total_tokens"),
    earlierMessagesNotKept: integer("earlier_messages_not_kept").notNull().default(0),
    commandLine: text("command_line"),
    exitCode: integer("exit_code"),
    /** The bytes of output kept now, to know when the cap is passed without reading it. */
    keptBytes: integer("kept_bytes").notNull().default(0),
    earlierOutputNotKept: bigint("earlier_output_not_kept", { mode: "number" })
      .notNull()
      .default(0),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.callId] }),
    index("sub_agents_and_processes_thread").on(table.threadId),
  ],
);

/** A Sub-agent's messages and tool calls, numbered in order per Sub-agent. */
export const subAgentMessages = pgTable(
  "sub_agent_messages",
  {
    sessionId: text("session_id").notNull(),
    callId: text("call_id").notNull(),
    sequence: integer("sequence").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    body: jsonb("body").$type<SubAgentMessageDraft>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.callId, table.sequence] }),
    foreignKey({
      columns: [table.sessionId, table.callId],
      foreignColumns: [subAgentsAndProcesses.sessionId, subAgentsAndProcesses.callId],
    }).onDelete("cascade"),
  ],
);

/** A Process's output, in the chunks it came in, numbered in order per Process. */
export const processOutput = pgTable(
  "process_output",
  {
    sessionId: text("session_id").notNull(),
    callId: text("call_id").notNull(),
    sequence: integer("sequence").notNull(),
    text: text("text").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.callId, table.sequence] }),
    foreignKey({
      columns: [table.sessionId, table.callId],
      foreignColumns: [subAgentsAndProcesses.sessionId, subAgentsAndProcesses.callId],
    }).onDelete("cascade"),
  ],
);
