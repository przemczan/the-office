import { Injectable, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { AttachmentService } from "../../application/attachment-service.js";
import { IdeaService } from "../../application/idea-service.js";
import { TaskService } from "../../application/task-service.js";
import { attachmentLines, type Attachment } from "../../domain/attachment.js";
import type { Author } from "../../domain/author.js";
import type { Idea } from "../../domain/idea.js";
import { confirmationWords } from "../../domain/planning.js";
import { PRIORITIES, type Task } from "../../domain/task.js";
import { TASK_STATE_NAMES } from "../../domain/task-states.js";
import { SessionPeople } from "../../ports/session-people.js";
import { answered, WorkToolRefused } from "./work-tool-answers.js";

export const LIST_TASKS = "list_tasks";
export const READ_TASK = "read_task";
export const LIST_IDEAS = "list_ideas";
export const READ_IDEA = "read_idea";
export const CAPTURE_IDEA = "capture_idea";
export const CREATE_TASK = "create_task";

/**
 * The Office tools a chat works with Work's records by (spec §6): it reads Tasks and Ideas,
 * captures an Idea and creates a Task in Backlog, each in the name of the person in the session.
 */
@Injectable()
export class WorkOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly tasks: TaskService,
    private readonly ideas: IdeaService,
    private readonly attachments: AttachmentService,
    private readonly sessionPeople: SessionPeople,
  ) {}

  onModuleInit(): void {
    this.registerListTasks();
    this.registerReadTask();
    this.registerListIdeas();
    this.registerReadIdea();
    this.registerCaptureIdea();
    this.registerCreateTask();
  }

  private registerListTasks(): void {
    this.registry.register({
      name: LIST_TASKS,
      description:
        "Lists The Office's Tasks in the board's order (priority, then the user's manual order): each one's id, title, Project, state and priority. Give a Project's id to list only its Tasks.",
      input: z.object({
        projectId: z.string().optional().describe("Only this Project's Tasks, by its id."),
      }),
      run: ({ projectId }) =>
        answered(async () => {
          const tasks = (await this.tasks.list()).filter(
            (task) => projectId === undefined || task.projectId === projectId,
          );
          if (tasks.length === 0) return "There is no Task yet.";
          return tasks.map(taskLine).join("\n");
        }),
    });
  }

  private registerReadTask(): void {
    this.registry.register({
      name: READ_TASK,
      description:
        "Reads one Task's record: its state, priority and Pipeline, its Plan, its Definition of Done, its Attachments and the Idea it came from.",
      input: z.object({ taskId: z.string().describe("The Task's id, as list_tasks gives it.") }),
      run: ({ taskId }) =>
        answered(async () => {
          const task = await this.tasks.read(taskId);
          const attachments = await this.attachments.listOf({ kind: "task", taskId: task.id });
          return taskRecord(task, attachments);
        }),
    });
  }

  private registerListIdeas(): void {
    this.registry.register({
      name: LIST_IDEAS,
      description:
        "Lists The Office's Ideas, the newest captured first: each one's id, title, Project (or Office-wide) and state (new, shaped into a Task, or dropped).",
      input: z.object({}),
      run: () =>
        answered(async () => {
          const ideas = await this.ideas.list();
          if (ideas.length === 0) return "There is no Idea yet.";
          return ideas.map(ideaLine).join("\n");
        }),
    });
  }

  private registerReadIdea(): void {
    this.registry.register({
      name: READ_IDEA,
      description:
        "Reads one Idea's record: its notes, who captured it and when, its Attachments, and the Task it was shaped into.",
      input: z.object({ ideaId: z.string().describe("The Idea's id, as list_ideas gives it.") }),
      run: ({ ideaId }) =>
        answered(async () => {
          const idea = await this.ideas.read(ideaId);
          const attachments = await this.attachments.listOf({ kind: "idea", ideaId: idea.id });
          return ideaRecord(idea, attachments);
        }),
    });
  }

  private registerCaptureIdea(): void {
    this.registry.register({
      name: CAPTURE_IDEA,
      description:
        "Captures an Idea in your name, in a Project or Office-wide, when the user asks for one or agrees to it. The user shapes it into a Task later.",
      input: z.object({
        title: z.string().describe("One line, as the user would say it."),
        notes: z.string().optional().describe("What else the user said about it."),
        projectId: z
          .string()
          .optional()
          .describe("The Project's id, as list_projects gives it; leave it out for Office-wide."),
      }),
      run: ({ title, notes, projectId }, { sessionId }) =>
        answered(async () => {
          const idea = await this.ideas.capture(
            { title, notes: notes ?? "", projectId },
            await this.personIn(sessionId),
          );
          return `Captured the Idea "${idea.title}" (Idea ${idea.id}), ${whereOf(idea.projectId)}.`;
        }),
    });
  }

  private registerCreateTask(): void {
    this.registry.register({
      name: CREATE_TASK,
      description:
        "Creates a Task in Backlog in your name, in one Project, when the user asks for one or agrees to it. It follows the Project's default Pipeline; planning it comes after.",
      input: z.object({
        title: z.string().describe("One line naming the outcome."),
        projectId: z.string().describe("The Project's id, as list_projects gives it."),
        priority: z.enum(PRIORITIES).optional().describe("Normal unless the user says otherwise."),
      }),
      run: ({ title, projectId, priority }, { sessionId }) =>
        answered(async () => {
          const task = await this.tasks.create(
            { title, projectId, priority: priority ?? "normal" },
            await this.personIn(sessionId),
          );
          return `Created the Task "${task.title}" (Task ${task.id}) in Backlog in ${task.projectId}, on the Pipeline ${task.pipelineId}.`;
        }),
    });
  }

  private async personIn(sessionId: string): Promise<Author> {
    const roleKey = await this.sessionPeople.personInSession(sessionId);
    if (roleKey === undefined) {
      throw new WorkToolRefused("The Office doesn't know whose session this is.");
    }
    return { kind: "person", roleKey };
  }
}

function taskLine(task: Task): string {
  return `- ${task.title} (Task ${task.id}) · Project ${task.projectId} · ${TASK_STATE_NAMES[task.state]} · ${task.priority} priority`;
}

function taskRecord(task: Task, attachments: readonly Attachment[]): string {
  return [
    `${task.title} (Task ${task.id})`,
    `- Project ${task.projectId}; ${TASK_STATE_NAMES[task.state]}; ${task.priority} priority; Pipeline ${task.pipelineId}`,
    `- Created by ${authorWords(task.createdBy)} on ${task.createdAt.toISOString()}`,
    ...(task.originIdeaId ? [`- Shaped from the Idea ${task.originIdeaId}`] : []),
    ...(task.proposedPipeline
      ? [
          `- Proposed Pipeline ${task.proposedPipeline.pipelineId}, not yet confirmed by the user: ${task.proposedPipeline.reason}`,
        ]
      : []),
    "",
    task.plan === "" ? "Plan:" : `Plan, ${confirmationWords(task.planConfirmed)}:`,
    task.plan === "" ? "No Plan yet." : task.plan,
    "",
    task.definitionOfDone.length === 0
      ? "Definition of Done:"
      : `Definition of Done, ${confirmationWords(task.definitionOfDoneConfirmed)}:`,
    ...(task.definitionOfDone.length === 0
      ? ["Not written yet."]
      : task.definitionOfDone.map((statement) => `- ${statement}`)),
    "",
    "Attachments:",
    ...attachmentLines(attachments),
  ].join("\n");
}

function ideaLine(idea: Idea): string {
  return `- ${idea.title} (Idea ${idea.id}) · ${whereOf(idea.projectId)} · ${idea.state}`;
}

function ideaRecord(idea: Idea, attachments: readonly Attachment[]): string {
  return [
    `${idea.title} (Idea ${idea.id})`,
    `- ${whereOf(idea.projectId)}; ${idea.state}${idea.taskId ? ` into the Task ${idea.taskId}` : ""}`,
    `- Captured by ${authorWords(idea.capturedBy)} on ${idea.capturedAt.toISOString()}`,
    "",
    "Notes:",
    idea.notes === "" ? "None." : idea.notes,
    "",
    "Attachments:",
    ...attachmentLines(attachments),
  ].join("\n");
}

function whereOf(projectId: string | undefined): string {
  return projectId === undefined ? "Office-wide" : `in the Project ${projectId}`;
}

function authorWords(author: Author): string {
  return author.kind === "user" ? "the user" : `the person in the Role ${author.roleKey}`;
}
