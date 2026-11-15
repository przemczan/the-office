import { Injectable, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { TaskService } from "../../application/task-service.js";
import { SessionInitiatives } from "../../ports/session-initiatives.js";
import { SessionTasks } from "../../ports/session-tasks.js";
import { answered, WorkToolRefused } from "./work-tool-answers.js";

export const WRITE_COMMIT_MESSAGE = "write_commit_message";

/**
 * The Office tool that writes the Task's commit message (spec §2.3, "The Task's commit message"):
 * the Planner suggests it while planning, and every Agent Stage updates it when its work changes what
 * it should say. In a Thread on a Task it writes onto that Task; in an Initiative's planning Thread,
 * onto the Initiative's Task it names. It never moves the Task.
 */
@Injectable()
export class CommitMessageOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly tasks: TaskService,
    private readonly sessionTasks: SessionTasks,
    private readonly sessionInitiatives: SessionInitiatives,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      name: WRITE_COMMIT_MESSAGE,
      description:
        "Writes the Task's commit message: the message of the one commit Publish lands the Task as on its base, and of its pull request (the first line its title, the rest its body). Follow the commit convention the Project's own docs define (CLAUDE.md, AGENTS.md, README, CONTRIBUTING and the like); with none, write the Task's title with a short summary of the change below it. It replaces the message the Task has, applies at once and never moves the Task; the user can change it until Publish. An empty message takes the default again. Refused once the Task is Done or Dropped, or once Publish has landed it.",
      input: z.object({
        taskId: z
          .string()
          .optional()
          .describe(
            "The Task's id. Leave it out in a Thread on the Task; in an Initiative's planning Thread, name one of the Initiative's Tasks.",
          ),
        message: z
          .string()
          .describe("The whole commit message: its subject line, a blank line, then its body."),
      }),
      run: ({ taskId, message }, { sessionId }) =>
        answered(async () => {
          const target = await this.taskOf(sessionId, taskId);
          const task = await this.tasks.changeCommitMessage(target, message);
          return task.commitMessage === ""
            ? "Cleared the commit message: Publish takes the default, the Task's title with a short summary below it."
            : "Wrote the commit message onto the Task.";
        }),
    });
  }

  /** The session's own Task, or in an Initiative's planning Thread the Initiative's Task named. */
  private async taskOf(sessionId: string, taskId: string | undefined): Promise<string> {
    const ownTaskId = await this.sessionTasks.taskInSession(sessionId);
    if (ownTaskId !== undefined) {
      if (taskId !== undefined && taskId !== ownTaskId) {
        throw new WorkToolRefused(
          "This Thread is on one Task, and writes onto it alone: leave the Task id out.",
        );
      }
      return ownTaskId;
    }
    const thread = await this.sessionInitiatives.initiativeThreadInSession(sessionId);
    if (!thread) {
      throw new WorkToolRefused(
        "This tool works in a Thread on a Task or in an Initiative's planning Thread, and this session is in neither.",
      );
    }
    if (taskId === undefined) {
      throw new WorkToolRefused(
        "Name the Task by its id: this Thread plans the Initiative's Tasks.",
      );
    }
    const task = await this.tasks.read(taskId);
    if (task.initiativeId !== thread.initiativeId) {
      throw new WorkToolRefused(
        "The Task isn't one of this Initiative's, so this Thread can't write onto it.",
      );
    }
    return task.id;
  }
}
