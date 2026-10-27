import { Injectable, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { MemoryService, RoleRefused } from "../../../people/index.js";
import { REMEMBER_TOOL } from "../../domain/session-instructions.js";
import { ThreadRepository } from "../../ports/thread-repository.js";

/**
 * The Office tool an Agent writes its person's Memory with (spec §2.2). It is offered to a session
 * only while the person's Shared memory is on; the Memory refuses a note otherwise.
 */
@Injectable()
export class MemoryOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly memory: MemoryService,
    private readonly threads: ThreadRepository,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      name: REMEMBER_TOOL,
      description:
        "Adds a note to your Memory, which every session you start later reads in its brief: something worth knowing next time, such as a preference of the user's or a lesson from a mistake. Notes are never edited, so write each one to stand alone, in a sentence or two. Name the Project when the note is about one; leave it out when it holds for all of them.",
      input: z.object({
        note: z.string().describe("What to remember, in a sentence or two."),
        project: z
          .string()
          .optional()
          .describe("The Project the note is about, as list_projects names it; none for all."),
      }),
      run: async ({ note, project }, { sessionId }) => {
        const thread = await this.threads.findBySession(sessionId);
        if (!thread) {
          return { text: "The Office doesn't know this session's Thread.", isError: true };
        }
        try {
          await this.memory.write({
            roleKey: thread.roleKey,
            projectId: project?.trim() || undefined,
            text: note,
            source: {
              kind: "agent",
              threadId: thread.id,
              taskId: thread.home.kind === "task" ? thread.home.taskId : undefined,
            },
          });
          return { text: "Noted: sessions you start from now on will read it.", isError: false };
        } catch (error) {
          if (error instanceof RoleRefused) return { text: error.message, isError: true };
          throw error;
        }
      },
    });
  }
}
