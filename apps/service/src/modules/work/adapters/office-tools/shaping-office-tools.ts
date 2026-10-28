import { Injectable, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { InitiativeService } from "../../application/initiative-service.js";
import { TaskService } from "../../application/task-service.js";
import { PRIORITIES } from "../../domain/task.js";
import { SessionInitiatives } from "../../ports/session-initiatives.js";
import { SessionPeople } from "../../ports/session-people.js";
import { answered, personInSession, WorkToolRefused } from "./work-tool-answers.js";

export const READ_INITIATIVE = "read_initiative";
export const WRITE_OUTCOME = "write_outcome";
export const ADD_TASK = "add_task";
export const ADD_DEPENDENCY = "add_dependency";
export const REMOVE_DEPENDENCY = "remove_dependency";

const ON_THE_PAGE =
  "It shows on the Initiative's page at once; the user confirms the whole Initiative once it is agreed.";

/**
 * The Office tools the CTO shapes an Initiative with, in a Thread on it (spec §2.1 Defaults): each
 * writes straight onto the session's own Initiative while it is being shaped.
 */
@Injectable()
export class ShapingOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly initiatives: InitiativeService,
    private readonly tasks: TaskService,
    private readonly sessionInitiatives: SessionInitiatives,
    private readonly sessionPeople: SessionPeople,
  ) {}

  onModuleInit(): void {
    this.registerReadInitiative();
    this.registerWriteOutcome();
    this.registerAddTask();
    this.registerAddDependency();
    this.registerRemoveDependency();
  }

  private registerReadInitiative(): void {
    this.registry.register({
      name: READ_INITIATIVE,
      description:
        "Reads this Initiative's record as it stands now: its state, the Projects it spans, its outcome, its Tasks with what each must wait for, and its Attachments. The user may have changed it since your Brief.",
      input: z.object({}),
      run: (_, { sessionId }) =>
        answered(async () => this.initiatives.recordText(await this.initiativeIn(sessionId))),
    });
  }

  private registerWriteOutcome(): void {
    this.registry.register({
      name: WRITE_OUTCOME,
      description: `Writes this Initiative's outcome: what must be true once it is done, in plain language the user agreed to. It replaces the outcome it has. ${ON_THE_PAGE}`,
      input: z.object({ outcome: z.string().describe("The whole outcome, in plain language.") }),
      run: ({ outcome }, { sessionId }) =>
        answered(async () => {
          await this.initiatives.writeOutcome(await this.initiativeIn(sessionId), outcome);
          return `Wrote the outcome onto the Initiative. ${ON_THE_PAGE}`;
        }),
    });
  }

  private registerAddTask(): void {
    this.registry.register({
      name: ADD_TASK,
      description: `Adds a Task to this Initiative in your name, in Backlog in one Project, on the Project's default Pipeline; planning it comes after. ${ON_THE_PAGE}`,
      input: z.object({
        title: z.string().describe("One line naming the outcome of this Task."),
        projectId: z.string().describe("The Project's id, as list_projects gives it."),
        priority: z.enum(PRIORITIES).optional().describe("Normal unless the user says otherwise."),
      }),
      run: ({ title, projectId, priority }, { sessionId }) =>
        answered(async () => {
          const task = await this.initiatives.addTaskWhileShaping(
            await this.initiativeIn(sessionId),
            { title, projectId, priority: priority ?? "normal" },
            await personInSession(this.sessionPeople, sessionId),
          );
          return `Added the Task "${task.title}" (Task ${task.id}) in Backlog in ${task.projectId}. ${ON_THE_PAGE}`;
        }),
    });
  }

  private registerAddDependency(): void {
    this.registry.register({
      name: ADD_DEPENDENCY,
      description: `Makes one of this Initiative's Tasks wait for another Task to be Done before it can start. The Task it waits for can be any Task, in any Project or Initiative; a Task can't wait for itself or close a cycle. ${ON_THE_PAGE}`,
      input: z.object({
        taskId: z.string().describe("The id of this Initiative's Task that must wait."),
        blockerId: z.string().describe("The id of the Task that must be Done first."),
      }),
      run: ({ taskId, blockerId }, { sessionId }) =>
        answered(async () => {
          const task = await this.initiatives.addDependencyWhileShaping(
            await this.initiativeIn(sessionId),
            taskId,
            blockerId,
          );
          const blocker = await this.tasks.read(blockerId);
          return `"${task.title}" now waits for "${blocker.title}" to be Done. ${ON_THE_PAGE}`;
        }),
    });
  }

  private registerRemoveDependency(): void {
    this.registry.register({
      name: REMOVE_DEPENDENCY,
      description: `Lets one of this Initiative's Tasks stop waiting for a Task it waits for. ${ON_THE_PAGE}`,
      input: z.object({
        taskId: z.string().describe("The id of this Initiative's Task that waits."),
        blockerId: z.string().describe("The id of the Task it waits for."),
      }),
      run: ({ taskId, blockerId }, { sessionId }) =>
        answered(async () => {
          const task = await this.initiatives.removeDependencyWhileShaping(
            await this.initiativeIn(sessionId),
            taskId,
            blockerId,
          );
          return `"${task.title}" no longer waits for the Task ${blockerId}. ${ON_THE_PAGE}`;
        }),
    });
  }

  private async initiativeIn(sessionId: string): Promise<string> {
    const initiativeId = await this.sessionInitiatives.initiativeInSession(sessionId);
    if (initiativeId === undefined) {
      throw new WorkToolRefused(
        "This tool works in a Thread on an Initiative, and this session is on none.",
      );
    }
    return initiativeId;
  }
}
