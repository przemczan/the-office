import { Injectable, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { InitiativeService } from "../../application/initiative-service.js";
import { TaskService } from "../../application/task-service.js";
import type { InitiativeEdit } from "../../domain/initiative-edit.js";
import { PRIORITIES } from "../../domain/task.js";
import { TASK_STATE_NAMES } from "../../domain/task-states.js";
import { SessionInitiatives } from "../../ports/session-initiatives.js";
import { SessionPeople } from "../../ports/session-people.js";
import {
  answered,
  personInSession,
  WorkToolRefused,
  type OfficeToolResult,
} from "./work-tool-answers.js";

export const READ_INITIATIVE = "read_initiative";
export const WRITE_OUTCOME = "write_outcome";
export const ADD_TASK = "add_task";
export const ADD_DEPENDENCY = "add_dependency";
export const REMOVE_DEPENDENCY = "remove_dependency";
export const WRITE_TASK_TITLE = "write_task_title";
export const WRITE_TASK_DESCRIPTION = "write_task_description";

const WHERE_IT_GOES =
  "While the Initiative is being shaped, it shows on the Initiative's page at once and the user confirms the whole Initiative once it is agreed; once it is active, it is drafted as a Proposal in this Thread, which changes the Initiative only when the user applies it.";

const ONLY_ON_AN_INITIATIVE =
  "This tool works in a Thread on an Initiative, and this session is on none.";

const NAME_THE_INITIATIVE =
  "This session is on no Initiative: give the id of the Initiative to read.";

const PROPOSED =
  "The Initiative is active, so this is drafted as a Proposal in this Thread: it changes the Initiative once the user applies it.";

/**
 * The Office tools the CTO shapes an Initiative with, in a Thread on it (spec §2.1 Defaults): each
 * writes straight onto the session's own Initiative while it is being shaped, and drafts a Proposal
 * of the change once it is active. `read_initiative` reads any Initiative by its id, so every chat
 * has it too.
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
    this.registerWriteTaskTitle();
    this.registerWriteTaskDescription();
  }

  private registerReadInitiative(): void {
    this.registry.register({
      name: READ_INITIATIVE,
      description:
        "Reads any Initiative's record as it stands now: its state, the Projects it spans, the Idea it was shaped from, its outcome, its Tasks with what each must wait for, and its Attachments by id. In a Thread on an Initiative it reads that one unless you name another; the user may have changed it since your Brief.",
      input: z.object({
        initiativeId: z
          .string()
          .optional()
          .describe(
            "The Initiative's id, as a Task's or an Idea's record gives it; leave it out in a Thread on an Initiative to read that one.",
          ),
      }),
      run: ({ initiativeId }, { sessionId }) =>
        answered(async () =>
          this.initiatives.recordText(
            initiativeId ?? (await this.initiativeIn(sessionId, NAME_THE_INITIATIVE)),
          ),
        ),
    });
  }

  private registerWriteOutcome(): void {
    this.registry.register({
      name: WRITE_OUTCOME,
      description: `Writes this Initiative's outcome: what must be true once it is done, in plain language the user agreed to. It replaces the outcome it has. ${WHERE_IT_GOES}`,
      input: z.object({ outcome: z.string().describe("The whole outcome, in plain language.") }),
      run: ({ outcome }, { sessionId }) =>
        this.change(sessionId, { kind: "outcome", outcome }, () =>
          Promise.resolve("Wrote the outcome onto the Initiative's page."),
        ),
    });
  }

  private registerAddTask(): void {
    this.registry.register({
      name: ADD_TASK,
      description: `Adds a Task to this Initiative in your name, in one Project, on the Project's default Pipeline, waiting from the start for the Tasks it names: in Shaping until the Initiative is confirmed, in Backlog from then on; planning it comes after. ${WHERE_IT_GOES}`,
      input: z.object({
        title: z.string().describe("One line naming the outcome of this Task."),
        projectId: z.string().describe("The Project's id, as list_projects gives it."),
        description: z
          .string()
          .optional()
          .describe("What the Task is for, in plain language; none when the title says it all."),
        priority: z.enum(PRIORITIES).optional().describe("Normal unless the user says otherwise."),
        blockedBy: z
          .array(z.string())
          .optional()
          .describe(
            "The ids of the Tasks that must be Done before this one can start, in any Project or Initiative; none unless it must wait.",
          ),
      }),
      run: ({ title, projectId, description, priority, blockedBy }, { sessionId }) =>
        this.change(
          sessionId,
          {
            kind: "add-task",
            title,
            projectId,
            priority: priority ?? "normal",
            description,
            blockedBy: blockedBy ?? [],
            taskId: undefined,
          },
          async (applied) => {
            const taskId = applied.kind === "add-task" ? applied.taskId : undefined;
            if (taskId === undefined) throw new Error("Adding the Task answered no Task.");
            const task = await this.tasks.read(taskId);
            const blockers = await Promise.all(task.blockedBy.map((id) => this.tasks.read(id)));
            const waiting = blockers.map((blocker) => `"${blocker.title}"`).join(" and ");
            return `Added the Task "${task.title}" (Task ${task.id}) in ${TASK_STATE_NAMES[task.state]} in ${task.projectId}${waiting && `, waiting for ${waiting}`}, on the Initiative's page.`;
          },
        ),
    });
  }

  private registerAddDependency(): void {
    this.registry.register({
      name: ADD_DEPENDENCY,
      description: `Makes one of this Initiative's Tasks wait for another Task to be Done before it can start. The Task it waits for can be any Task, in any Project or Initiative; a Task can't wait for itself or close a cycle. ${WHERE_IT_GOES}`,
      input: z.object({
        taskId: z.string().describe("The id of this Initiative's Task that must wait."),
        blockerId: z.string().describe("The id of the Task that must be Done first."),
      }),
      run: ({ taskId, blockerId }, { sessionId }) =>
        this.change(sessionId, { kind: "add-dependency", taskId, blockerId }, async () => {
          const [task, blocker] = await Promise.all([
            this.tasks.read(taskId),
            this.tasks.read(blockerId),
          ]);
          return `"${task.title}" now waits for "${blocker.title}" to be Done, on the Initiative's page.`;
        }),
    });
  }

  private registerRemoveDependency(): void {
    this.registry.register({
      name: REMOVE_DEPENDENCY,
      description: `Lets one of this Initiative's Tasks stop waiting for a Task it waits for. ${WHERE_IT_GOES}`,
      input: z.object({
        taskId: z.string().describe("The id of this Initiative's Task that waits."),
        blockerId: z.string().describe("The id of the Task it waits for."),
      }),
      run: ({ taskId, blockerId }, { sessionId }) =>
        this.change(sessionId, { kind: "remove-dependency", taskId, blockerId }, async () => {
          const task = await this.tasks.read(taskId);
          return `"${task.title}" no longer waits for the Task ${blockerId}, on the Initiative's page.`;
        }),
    });
  }

  private registerWriteTaskTitle(): void {
    this.registry.register({
      name: WRITE_TASK_TITLE,
      description: `Replaces the title of one of this Initiative's Tasks, until the Task starts. ${WHERE_IT_GOES}`,
      input: z.object({
        taskId: z.string().describe("The id of this Initiative's Task."),
        title: z.string().describe("One line naming the outcome of this Task."),
      }),
      run: ({ taskId, title }, { sessionId }) =>
        this.change(sessionId, { kind: "task-title", taskId, title }, async () => {
          const task = await this.tasks.read(taskId);
          return `The Task ${task.id} is now titled "${task.title}", on the Initiative's page.`;
        }),
    });
  }

  private registerWriteTaskDescription(): void {
    this.registry.register({
      name: WRITE_TASK_DESCRIPTION,
      description: `Replaces the whole Description of one of this Initiative's Tasks, until the Task starts; empty leaves it none. The user may have written it, so read the Task with read_task first and keep what they said. ${WHERE_IT_GOES}`,
      input: z.object({
        taskId: z.string().describe("The id of this Initiative's Task."),
        description: z.string().describe("The whole Description, in plain language."),
      }),
      run: ({ taskId, description }, { sessionId }) =>
        this.change(sessionId, { kind: "task-description", taskId, description }, async () => {
          const task = await this.tasks.read(taskId);
          return `Wrote the Description of "${task.title}" onto its page.`;
        }),
    });
  }

  /** The CTO's change to the session's Initiative, answered as `written` words it or as proposed. */
  private change(
    sessionId: string,
    edit: InitiativeEdit,
    written: (applied: InitiativeEdit) => Promise<string>,
  ): Promise<OfficeToolResult> {
    return answered(async () => {
      const change = await this.initiatives.changeByCto(
        await this.initiativeIn(sessionId),
        edit,
        await personInSession(this.sessionPeople, sessionId),
        sessionId,
      );
      return change.kind === "written" ? written(change.edit) : PROPOSED;
    });
  }

  private async initiativeIn(sessionId: string, onNone = ONLY_ON_AN_INITIATIVE): Promise<string> {
    const initiativeId = await this.sessionInitiatives.initiativeInSession(sessionId);
    if (initiativeId === undefined) throw new WorkToolRefused(onNone);
    return initiativeId;
  }
}
