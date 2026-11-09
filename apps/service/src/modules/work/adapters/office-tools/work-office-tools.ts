import { Injectable, type OnModuleInit } from "@nestjs/common";
import { CAPTURE_IDEA_TOOL } from "@the-office/contracts";
import { z } from "zod";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { AttachmentService } from "../../application/attachment-service.js";
import { IdeaRecords } from "../../application/idea-records.js";
import { IdeaService } from "../../application/idea-service.js";
import { InitiativeService } from "../../application/initiative-service.js";
import { TaskRecords } from "../../application/task-records.js";
import { TaskService } from "../../application/task-service.js";
import { attachmentKindWords, type Attachment } from "../../domain/attachment.js";
import type { Idea } from "../../domain/idea.js";
import { whereOf } from "../../domain/record-words.js";
import { PRIORITIES, type Task } from "../../domain/task.js";
import { isArchived } from "../../domain/task-archive.js";
import { TASK_STATE_NAMES } from "../../domain/task-states.js";
import type { WrittenPlanAndDefinitionOfDone } from "../../domain/written-parts.js";
import { IdeaCards } from "../../ports/idea-cards.js";
import { SessionPeople } from "../../ports/session-people.js";
import { answered, personInSession, WorkToolRefused } from "./work-tool-answers.js";

export const LIST_TASKS = "list_tasks";
export const READ_TASK = "read_task";
export const LIST_IDEAS = "list_ideas";
export const READ_IDEA = "read_idea";
export const READ_ATTACHMENT = "read_attachment";
export const CREATE_TASK = "create_task";

/**
 * How much of a document read_attachment answers with, so one large file can't fill the session's
 * context; about 15k tokens of English.
 */
export const DOCUMENT_READ_LIMIT = 60_000;

/**
 * The Office tools sessions work with Work's records by (spec §6): every session reads every Task,
 * Idea and Attachment, whatever it is on; a chat also captures an Idea and creates a Task in
 * Backlog, each in the name of the person in the session.
 */
@Injectable()
export class WorkOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly tasks: TaskService,
    private readonly taskRecords: TaskRecords,
    private readonly ideas: IdeaService,
    private readonly ideaRecords: IdeaRecords,
    private readonly initiatives: InitiativeService,
    private readonly attachments: AttachmentService,
    private readonly sessionPeople: SessionPeople,
    private readonly ideaCards: IdeaCards,
  ) {}

  onModuleInit(): void {
    this.registerListTasks();
    this.registerReadTask();
    this.registerListIdeas();
    this.registerReadIdea();
    this.registerReadAttachment();
    this.registerCaptureIdea();
    this.registerCreateTask();
  }

  private registerListTasks(): void {
    this.registry.register({
      name: LIST_TASKS,
      description:
        "Lists The Office's Tasks on the board, in its order (priority, then the user's manual order): each one's id, title, Project, state and priority. Archived Tasks are left out; read_task still reads one by its id. Give a Project's id to list only its Tasks.",
      input: z.object({
        projectId: z.string().optional().describe("Only this Project's Tasks, by its id."),
      }),
      run: ({ projectId }) =>
        answered(async () => {
          const tasks = (await this.tasks.list()).filter(
            (task) =>
              !isArchived(task) && (projectId === undefined || task.projectId === projectId),
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
        "Reads any Task's record, archived ones too: its state, priority and Pipeline, its Description, Plan and Definition of Done, its linked records (the Tasks it waits for and that wait for it, the Idea it came from and its Initiative, each with its id), its Attachments by id, its Stage results with every Handover note, and its state changes with who or what made each.",
      input: z.object({ taskId: z.string().describe("The Task's id, as list_tasks gives it.") }),
      run: ({ taskId }) => answered(() => this.taskRecords.recordText(taskId)),
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
        "Reads any Idea's record: its notes, who captured it and when, its Attachments by id, and the Task or Initiative it was shaped into, with its id.",
      input: z.object({
        ideaId: z.string().describe("The Idea's id, as list_ideas or another record gives it."),
      }),
      run: ({ ideaId }) => answered(() => this.ideaRecords.recordText(ideaId)),
    });
  }

  private registerReadAttachment(): void {
    this.registry.register({
      name: READ_ATTACHMENT,
      description:
        "Reads any Attachment by its id, whether a Task's (archived ones too), an Idea's or an Initiative's, and names what it belongs to: a document's text, a link's address, and an image's or other file's name and kind, since only a document is read as text.",
      input: z.object({
        attachmentId: z
          .string()
          .describe(
            "The Attachment's id, as your Brief, read_task, read_idea or read_initiative lists it.",
          ),
      }),
      run: ({ attachmentId }) =>
        answered(async () => {
          const attachment = await this.attachments.read(attachmentId);
          return `${await this.ownerWords(attachment)}\n\n${await this.readingOf(attachment)}`;
        }),
    });
  }

  private registerCaptureIdea(): void {
    this.registry.register({
      name: CAPTURE_IDEA_TOOL,
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
            await personInSession(this.sessionPeople, sessionId),
          );
          await this.ideaCards.postIdeaCard(sessionId, idea.id);
          return `Captured the Idea "${idea.title}" (Idea ${idea.id}), ${whereOf(idea.projectId)}. Its card is in this chat, for the user to plan it from.`;
        }),
    });
  }

  private registerCreateTask(): void {
    this.registry.register({
      name: CREATE_TASK,
      description:
        "Creates a Task in Backlog in your name, in one Project, when the user asks for one or agrees to it. It follows the Project's default Pipeline. Give it a title and, when the user said what it is for, a Description the Planner plans from. When it is already known how the Task will be done and what must be true when it is, give it both a Plan and a Definition of Done, or neither: they land Not confirmed, and the user confirms each on the Task page and marks the Task Ready without Planning, or plans it from them.",
      input: z.object({
        title: z.string().describe("One line naming the outcome."),
        description: z
          .string()
          .optional()
          .describe(
            "What the Task is for, in the user's own words; none when the title says it all.",
          ),
        projectId: z.string().describe("The Project's id, as list_projects gives it."),
        priority: z.enum(PRIORITIES).optional().describe("Normal unless the user says otherwise."),
        plan: z
          .string()
          .optional()
          .describe(
            "How the Task will be done, as Markdown, in plain words whoever implements it can follow. Only with a Definition of Done.",
          ),
        filesToChange: z
          .array(z.string())
          .optional()
          .describe(
            "The files and folders the Plan expects to change, as paths from the repository's root; a folder covers everything under it. Only with a Plan.",
          ),
        estimatedTokens: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "The tokens (input, output and cache writes) you expect the whole Pipeline to use, every Stage together. Only with a Plan.",
          ),
        definitionOfDone: z
          .array(z.string())
          .optional()
          .describe(
            "What must be true when the Task is done, one plain-language statement each that can be checked. Only with a Plan.",
          ),
      }),
      run: ({ title, description, projectId, priority, ...parts }, { sessionId }) =>
        answered(async () => {
          const task = await this.tasks.create(
            { title, description, projectId, priority: priority ?? "normal" },
            await personInSession(this.sessionPeople, sessionId),
            writtenPartsGiven(parts),
          );
          const created = `Created the Task "${task.title}" (Task ${task.id}) in Backlog in ${task.projectId}, on the Pipeline ${task.pipelineId}.`;
          return parts.plan === undefined
            ? created
            : `${created} Its Plan and Definition of Done are Not confirmed until the user confirms each on the Task page.`;
        }),
    });
  }

  private async ownerWords({ owner }: Attachment): Promise<string> {
    switch (owner.kind) {
      case "task": {
        const task = await this.tasks.read(owner.taskId);
        return `Attached to Task ${task.id}: ${task.title}${isArchived(task) ? " (archived)" : ""}.`;
      }
      case "idea":
        return `Attached to Idea ${owner.ideaId}: ${(await this.ideas.read(owner.ideaId)).title}.`;
      case "initiative": {
        const { id, name } = await this.initiatives.read(owner.initiativeId);
        return `Attached to Initiative ${id}: ${name}.`;
      }
    }
  }

  private async readingOf(attachment: Attachment): Promise<string> {
    const heading = `${attachment.name} (${attachmentKindWords(attachment)})`;
    if (attachment.kind === "link") {
      return `${heading}. The Office keeps its address only; fetch it if you need what it says.`;
    }
    if (attachment.kind !== "document") {
      return `${heading}. Only a document is read as text; ask the user what it holds if you need to know.`;
    }
    const { text, cut } = await this.attachments.documentText(attachment.id, DOCUMENT_READ_LIMIT);
    const ending = cut
      ? `\n\nThe document goes on: these are its first ${DOCUMENT_READ_LIMIT} bytes.`
      : "";
    return `${heading}:\n\n${text}${ending}`;
  }
}

function taskLine(task: Task): string {
  return `- ${task.title} (Task ${task.id}) · Project ${task.projectId} · ${TASK_STATE_NAMES[task.state]} · ${task.priority} priority`;
}

function ideaLine(idea: Idea): string {
  return `- ${idea.title} (Idea ${idea.id}) · ${whereOf(idea.projectId)} · ${idea.state}`;
}

const HALF_A_PAIR =
  "Give both the Plan and the Definition of Done, or neither: Ready needs both, so one alone helps nobody.";
const PLAN_DETAILS_WITHOUT_PLAN =
  "Files to change and a token estimate are part of the Plan: give them only with a Plan.";

interface GivenParts {
  readonly plan?: string | undefined;
  readonly filesToChange?: readonly string[] | undefined;
  readonly estimatedTokens?: number | undefined;
  readonly definitionOfDone?: readonly string[] | undefined;
}

/** Both parts, or none; half of the pair is refused before any Task is made. */
function writtenPartsGiven({
  plan,
  filesToChange,
  estimatedTokens,
  definitionOfDone,
}: GivenParts): WrittenPlanAndDefinitionOfDone | undefined {
  const problems: string[] = [];
  if ((plan === undefined) !== (definitionOfDone === undefined)) problems.push(HALF_A_PAIR);
  if (plan === undefined && (filesToChange !== undefined || estimatedTokens !== undefined)) {
    problems.push(PLAN_DETAILS_WITHOUT_PLAN);
  }
  if (problems.length > 0) throw new WorkToolRefused(problems.join(" "));
  if (plan === undefined || definitionOfDone === undefined) return undefined;
  return { plan: { plan, filesToChange, estimatedTokens }, definitionOfDone };
}
