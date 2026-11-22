import { Injectable, type OnModuleInit } from "@nestjs/common";
import { PROPOSE_BUG_TASK_TOOL } from "@the-office/contracts";
import { z } from "zod";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { BugTaskDecisions } from "../../application/bug-task-decisions.js";
import { ThreadRefused } from "../../domain/thread-refused.js";

/** What propose_bug_task answers once the Decision is open. */
export const BUG_TASK_DECISION_OPENED = "Opened the Decision. End the Stage with needs_decision.";

/**
 * The Office tool an Agent in a Stage proposes a Bug Task with (spec §2.4): an issue too big for its
 * Task or outside its scope. It opens a bug-task Decision on the Agent's own Task, whose answer
 * comes as the Agent's next message, as an open_decision's does. Pipelines gives it to every Agent
 * Stage (`AGENT_STAGE_OFFICE_TOOLS`), and no other session.
 */
@Injectable()
export class BugTaskOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly bugTasks: BugTaskDecisions,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      name: PROPOSE_BUG_TASK_TOOL,
      description:
        "Proposes a Bug Task for an issue you found that is too big for this Task or outside its scope, instead of fixing it here. It opens a Decision on this Task: the user may edit the Bug Task, then creates it in Backlog, found while working on this Task, doesn't, or answers Fix now, which creates none and has you fix it within this Task. It returns at once; then end the Stage with needs_decision and your Handover note. The answer, naming the new Task, saying no, or saying to fix it now, with the user's comment, comes as your next message: go on with your own work then, first fixing it within this Task when the answer is Fix now.",
      input: z.object({
        title: z.string().describe("The Bug Task's title: what is wrong, in a line."),
        description: z
          .string()
          .describe(
            "The Bug Task's Description in Markdown: steps to reproduce, what you expected and what happens.",
          ),
        why: z
          .string()
          .describe(
            "What you found and why it isn't fixed within this Task, in a few lines, for the user to decide on.",
          ),
        projectId: z
          .string()
          .optional()
          .describe("The Project the Bug Task is in, by its id; leave it out for this Task's."),
        causedBy: z
          .string()
          .optional()
          .describe("The Task whose work caused the issue, by its id, when you know it."),
      }),
      run: async (input, { sessionId }) => {
        try {
          await this.bugTasks.propose(sessionId, input);
          return { text: BUG_TASK_DECISION_OPENED, isError: false };
        } catch (error) {
          if (error instanceof ThreadRefused) return { text: error.message, isError: true };
          throw error;
        }
      },
    });
  }
}
