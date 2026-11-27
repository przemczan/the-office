import { Injectable, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import { CORE_AREA, OfficeToolRegistry } from "../../../engine/index.js";
import { ThreadHistory } from "../../application/thread-history.js";
import { READ_THREADS_TOOL } from "../../domain/session-instructions.js";
import { THREAD_HISTORY_READ_LIMIT } from "../../domain/thread-history-words.js";

/**
 * The Office tool a person reads Thread messages with (spec 2.4): read-only, from The Office's log
 * alone, so nobody needs the database or an engine's transcripts. It answers at once.
 */
@Injectable()
export class ThreadHistoryOfficeTool implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly history: ThreadHistory,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      name: READ_THREADS_TOOL,
      area: CORE_AREA,
      description: `Reads the messages of The Office's Threads logged in a range of dates or times: chats, Threads on Tasks (Stage Threads and Consultations too) and Threads on Initiatives, grouped by Thread with its subject, each message with its time, its speaker (the user, a person by name and Role, or The Office) and its text. Tool activity shows as its one-line summary, and Decisions and Proposals as their question or title with the answer or state. Narrow it by a person, a Task, an Initiative (its shaping and planning Threads), a Project or a text. An answer holds at most ${THREAD_HISTORY_READ_LIMIT} characters: a full one ends saying how many messages are left out and the message to read on after. It reads only The Office's log, never a file or an engine's transcript.`,
      input: z.object({
        from: z
          .string()
          .describe(
            "The range's start: a date, as 2026-11-05, which reads from that day's start in UTC, or a time, as 2026-11-05T09:00:00Z; a time with no offset reads in UTC.",
          ),
        to: z
          .string()
          .describe(
            "The range's end: a date, which reads to that day's end in UTC, or a time; the end is included.",
          ),
        personRole: z
          .string()
          .optional()
          .describe(
            "Only the Threads with this person, by their Role's key, as list_people gives it.",
          ),
        taskId: z
          .string()
          .optional()
          .describe("Only the Threads on this Task, by its id, as list_tasks gives it."),
        initiativeId: z
          .string()
          .optional()
          .describe(
            "Only the Threads on this Initiative, its shaping and planning Threads, by its id, as read_task or read_initiative names it; earlier planning Threads included.",
          ),
        projectId: z
          .string()
          .optional()
          .describe(
            "Only the Threads on this Project's Tasks and on the Initiatives spanning it, by its id, as list_projects gives it; chats have no Project.",
          ),
        search: z
          .string()
          .optional()
          .describe("Only the messages holding this text, matched literally and in any case."),
        after: z
          .string()
          .optional()
          .describe(
            "To read on: the message id a full answer's last line names, with the same range and filters.",
          ),
      }),
      run: async (query) => ({ text: await this.history.read(query), isError: false }),
    });
  }
}
