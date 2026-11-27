import { Injectable, type OnModuleInit } from "@nestjs/common";
import { CAPTURE_IDEA_TOOL } from "@the-office/contracts";
import { z } from "zod";
import { CORE_AREA, OfficeToolRegistry } from "../../../engine/index.js";
import { AttachmentService } from "../../application/attachment-service.js";
import { IdeaRecords } from "../../application/idea-records.js";
import { IdeaService } from "../../application/idea-service.js";
import {
  InitiativeService,
  type ShapingThreadOpening,
} from "../../application/initiative-service.js";
import { TaskRecords } from "../../application/task-records.js";
import { TaskService } from "../../application/task-service.js";
import {
  attachmentKindWords,
  fileReadingOf,
  zipEntryLine,
  type Attachment,
  type StoredFileAttachment,
} from "../../domain/attachment.js";
import type { Idea } from "../../domain/idea.js";
import { whereOf } from "../../domain/linked-records.js";
import { PRIORITIES, TASK_KINDS, type Task, type TaskSummary } from "../../domain/task.js";
import { isArchived } from "../../domain/task-archive.js";
import { TASK_STATE_NAMES } from "../../domain/task-states.js";
import {
  DEFAULT_CONTEXT_LINES,
  DEFAULT_LINE_COUNT,
  lineCountWords,
  MAX_CONTEXT_LINES,
  MAX_LINE_COUNT,
  type LineReading,
  type LinesPart,
} from "../../domain/text-lines.js";
import type { WrittenPlanAndDefinitionOfDone } from "../../domain/written-parts.js";
import { IdeaCards } from "../../ports/idea-cards.js";
import { SessionPeople } from "../../ports/session-people.js";
import { SessionTasks } from "../../ports/session-tasks.js";
import {
  answered,
  personInSession,
  WorkToolRefused,
  type OfficeToolResult,
} from "./work-tool-answers.js";

export const LIST_TASKS = "list_tasks";
export const READ_TASK = "read_task";
export const LIST_IDEAS = "list_ideas";
export const READ_IDEA = "read_idea";
export const READ_ATTACHMENT = "read_attachment";
export const CREATE_TASK = "create_task";
export const CREATE_INITIATIVE = "create_initiative";

/**
 * The most characters read_attachment answers a text file or a PDF's text with, its header
 * included. Claude Code keeps a tool's answer in the session only up to 50,000 characters; a
 * longer one is saved to a file in the engine's own folder, which Agents may not read, and the
 * session sees a 2 KB preview.
 * Measured on 2026-11-10 with Claude Code 2.1.310 (Agent SDK 0.3.310), on claude-haiku-5-5: an
 * Office-style SDK MCP tool answered 10,000 to 80,000 characters, and the model reported which
 * answers it saw whole. 50,000 came back inline and 50,001 was saved to a file; 45,000 two-byte
 * characters (90,000 bytes) came back inline, so the limit counts characters. Half of it leaves
 * a clear margin for a later engine lowering it.
 */
export const ATTACHMENT_ANSWER_BUDGET = 25_000;

/**
 * Room for the words after the heading, a PDF's the longest: a 50 MB file has fewer than 100
 * million lines.
 */
const LINES_HEADING_ROOM = ", its text in 99,999,999 lines, a marker line before each page:\n\n"
  .length;

/** Room for the words naming a file in a zip, besides its path: a 50 MB file's size the longest. */
const ZIP_ENTRY_HEADING_ROOM = ", a zip.\n\nIn it,  (99999999 bytes)".length;

/**
 * The Office tools sessions work with Work's records by (spec §6): every session reads every Task,
 * Idea and Attachment, whatever it is on; every Thread the user talks in also captures an Idea and
 * creates a Task in Backlog, and whoever shapes Initiatives or is the Default person to talk to
 * also creates an Initiative being shaped, each in the name of the person in the session. An Idea
 * or a Task created in a Thread on a Task is found while working on that Task unless the tool says
 * otherwise.
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
    private readonly sessionTasks: SessionTasks,
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
    this.registerCreateInitiative();
  }

  private registerListTasks(): void {
    this.registry.register({
      name: LIST_TASKS,
      area: CORE_AREA,
      description:
        "Lists The Office's Tasks on the board, in its order (priority, then the user's manual order): each one's id, title, Project, state and priority. Archived Tasks are left out; read_task still reads one by its id. Give a Project's id to list only its Tasks.",
      input: z.object({
        projectId: z.string().optional().describe("Only this Project's Tasks, by its id."),
      }),
      run: ({ projectId }) =>
        answered(async () => {
          const tasks = await this.tasks.onTheBoard(projectId);
          if (tasks.length === 0) return "There is no Task yet.";
          return tasks.map(taskLine).join("\n");
        }),
    });
  }

  private registerReadTask(): void {
    this.registry.register({
      name: READ_TASK,
      area: CORE_AREA,
      description:
        "Reads any Task's record, archived ones too: its state, priority and Pipeline, its Description, Plan and Definition of Done, its linked records (the Tasks it waits for and that wait for it, the Idea it came from and its Initiative, each with its id), its Attachments by id, its Connected devices with kind, name, state and endpoint, its Stage results with every Handover note, and its state changes with who or what made each.",
      input: z.object({ taskId: z.string().describe("The Task's id, as list_tasks gives it.") }),
      run: ({ taskId }) => answered(() => this.taskRecords.recordText(taskId)),
    });
  }

  private registerListIdeas(): void {
    this.registry.register({
      name: LIST_IDEAS,
      area: CORE_AREA,
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
      area: CORE_AREA,
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
      area: CORE_AREA,
      description:
        "Reads any Attachment by its id, whether a Task's (archived ones too), an Idea's or an Initiative's, names what it belongs to, and answers by what it holds. A text file (a document, a CSS or JSON file, a log: any file whose bytes are text) is read by its lines, each with its number, like a file with Read and Grep: give fromLine and lineCount for a slice of it, or a search phrase for the lines that hold it with a few lines around each. A PDF's text is read the same way, with a marker line before each page. One answer holds only so much, so a long file is read in slices: every answer ends by saying where the file goes on and which fromLine reads on, and a line too long for one answer is cut, its note giving the fromLine and fromCharacter to read on with. A search's line numbers are a slice's, so a match's line given as fromLine reads on from it. An image comes as the picture itself on an engine that shows pictures, else with words saying why it isn't shown. A zip is unzipped as it is read: it lists the files it holds, by path and size, read like a text file's lines; give entry, a path from that list, to read that one file as any of these. Any other file answers its name, kind and size, as it can't be read; a link its address.",
      input: z.object({
        attachmentId: z
          .string()
          .describe(
            "The Attachment's id, as your Brief, read_task, read_idea or read_initiative lists it.",
          ),
        entry: z
          .string()
          .min(1)
          .optional()
          .describe(
            "For a zip: the path of one file in it, as its list gives it, to read that file instead of the list. The other fields then read that file.",
          ),
        fromLine: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            "For a text file or a PDF: the line the slice or the search starts at, counting from 1. The first line when left out.",
          ),
        fromCharacter: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            "For a slice: the character of its first line to start at, counting from 1, to read on in a line too long for one answer, as its cut note says. The line's start when left out.",
          ),
        lineCount: z
          .number()
          .int()
          .min(1)
          .max(MAX_LINE_COUNT)
          .optional()
          .describe(
            `For a slice: how many lines it gives, ${DEFAULT_LINE_COUNT} when left out. An answer that would grow too long stops sooner and says where to read on.`,
          ),
        search: z
          .string()
          .min(1)
          .optional()
          .describe(
            "For a text file or a PDF: a phrase to find, matched literally and whatever the case, one line at a time. Answers the lines that hold it instead of a slice.",
          ),
        contextLines: z
          .number()
          .int()
          .min(0)
          .max(MAX_CONTEXT_LINES)
          .optional()
          .describe(
            `For a search: how many lines to show before and after each match, ${DEFAULT_CONTEXT_LINES} when left out.`,
          ),
      }),
      run: ({ attachmentId, entry, ...reading }) =>
        answered(async () => {
          const attachment = await this.attachments.read(attachmentId);
          const opening = `${await this.ownerWords(attachment)}\n\n${attachment.name} (${attachmentKindWords(attachment)})`;
          if (attachment.kind === "link") {
            return `${opening}. The Office keeps its address only; fetch it if you need what it says.`;
          }
          const fileReading = fileReadingOf(attachment);
          if (entry !== undefined && fileReading !== "zip") {
            throw new WorkToolRefused(
              "entry reads one file in a zip, and this Attachment is no zip; leave entry out.",
            );
          }
          switch (fileReading) {
            case "lines":
              return this.linesAnswer(attachment, opening, reading);
            case "pdf-text":
              return this.pdfTextAnswer(attachment, opening, reading);
            case "picture":
              return this.pictureAnswer(attachment, opening);
            case "zip":
              return entry === undefined
                ? this.zipEntriesAnswer(attachment, opening, reading)
                : this.zipEntryAnswer(attachment, opening, entry, reading);
            case "unreadable":
              return `${opening}. It is neither text, a PDF nor an image, so it can't be read; ask the user what it holds if you need to know.`;
          }
        }),
    });
  }

  private async linesAnswer(
    file: StoredFileAttachment,
    opening: string,
    reading: ReadingAsked,
  ): Promise<string> {
    const { lineCount, text } = await this.readLines(file, opening, reading);
    return `${opening}, ${lineCountWords(lineCount)}:\n\n${text}`;
  }

  private async pdfTextAnswer(
    file: StoredFileAttachment,
    opening: string,
    reading: ReadingAsked,
  ): Promise<string> {
    const { lineCount, text } = await this.readLines(file, opening, reading);
    if (lineCount === 0) {
      return `${opening}. This PDF has no text to read, as a scanned one has none; ask the user what it holds if you need to know.`;
    }
    return `${opening}, its text in ${lineCountWords(lineCount)}, a marker line before each page:\n\n${text}`;
  }

  private async zipEntriesAnswer(
    file: StoredFileAttachment,
    opening: string,
    reading: ReadingAsked,
  ): Promise<string> {
    const { lineCount, text } = await this.attachments.readZipEntries(
      file.id,
      lineReading(reading),
      ATTACHMENT_ANSWER_BUDGET - opening.length - LINES_HEADING_ROOM,
    );
    if (lineCount === 0) return `${opening}. This zip holds no file.`;
    return `${opening}, a zip of ${fileCountWords(lineCount)}, each by its path and size; read one with entry:\n\n${text}`;
  }

  private async zipEntryAnswer(
    file: StoredFileAttachment,
    opening: string,
    path: string,
    reading: ReadingAsked,
  ): Promise<string | OfficeToolResult> {
    const read = await this.attachments.readZipEntry(
      file.id,
      path,
      lineReading(reading),
      ATTACHMENT_ANSWER_BUDGET -
        opening.length -
        path.length -
        ZIP_ENTRY_HEADING_ROOM -
        LINES_HEADING_ROOM,
    );
    const entryOpening = `${opening}, a zip.\n\nIn it, ${zipEntryLine(read.entry)}`;
    switch (read.reading) {
      case "lines":
        return `${entryOpening}, ${lineCountWords(read.part.lineCount)}:\n\n${read.part.text}`;
      case "pdf-text":
        if (read.part.lineCount === 0) {
          return `${entryOpening}. This PDF has no text to read, as a scanned one has none.`;
        }
        return `${entryOpening}, its text in ${lineCountWords(read.part.lineCount)}, a marker line before each page:\n\n${read.part.text}`;
      case "picture":
        return {
          text: `${entryOpening}.`,
          isError: false,
          pictures: [{ name: baseNameOf(path), mediaType: read.mediaType, content: read.content }],
        };
      case "unreadable":
        return `${entryOpening}. It is neither text, a PDF nor an image, so it can't be read.`;
    }
  }

  private readLines(
    file: StoredFileAttachment,
    opening: string,
    reading: ReadingAsked,
  ): Promise<LinesPart> {
    return this.attachments.readLines(
      file.id,
      lineReading(reading),
      ATTACHMENT_ANSWER_BUDGET - opening.length - LINES_HEADING_ROOM,
    );
  }

  private async pictureAnswer(
    file: StoredFileAttachment,
    opening: string,
  ): Promise<OfficeToolResult> {
    const { mediaType, content } = await this.attachments.readPicture(file.id);
    return {
      text: `${opening}.`,
      isError: false,
      pictures: [{ name: file.name, mediaType, content }],
    };
  }

  private registerCaptureIdea(): void {
    this.registry.register({
      name: CAPTURE_IDEA_TOOL,
      area: CORE_AREA,
      description:
        "Captures an Idea in your name, in a Project or Office-wide, when the user asks for one or agrees to it. The user shapes it into a Task later.",
      input: z.object({
        title: z.string().describe("One line, as the user would say it."),
        notes: z.string().optional().describe("What else the user said about it."),
        projectId: z
          .string()
          .optional()
          .describe("The Project's id, as list_projects gives it; leave it out for Office-wide."),
        taskId: FOUND_WHILE_WORKING_ON_INPUT,
      }),
      run: ({ title, notes, projectId, taskId }, { sessionId }) =>
        answered(async () => {
          const foundWhile = await this.foundWhileWorkingOn(taskId, sessionId);
          const idea = await this.ideas.capture(
            { title, notes: notes ?? "", projectId },
            await personInSession(this.sessionPeople, sessionId),
            foundWhile?.id,
          );
          await this.ideaCards.postIdeaCard(sessionId, idea.id);
          return `Captured the Idea "${idea.title}" (Idea ${idea.id}), ${whereOf(idea.projectId)}${foundWhileWords(foundWhile)}. Its card is in this Thread, for the user to plan it from.`;
        }),
    });
  }

  private registerCreateTask(): void {
    this.registry.register({
      name: CREATE_TASK,
      area: "work",
      description:
        "Creates a Task in Backlog in your name, in one Project, when the user asks for one or agrees to it. It has no Pipeline until the Planner proposes one or the user chooses one. Give it a title and, when the user said what it is for, a Description the Planner plans from. When it is already known how the Task will be done and what must be true when it is, give it both a Plan and a Definition of Done, or neither: they land Not confirmed, and the user confirms each and chooses a Pipeline on the Task page and marks the Task Ready without Planning, or plans it from them.",
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
        kind: z
          .enum(TASK_KINDS)
          .optional()
          .describe(
            "feature (something new or changed on purpose), bug (something that works wrong) or chore (upkeep that changes nothing for the user); feature when left out.",
          ),
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
        taskId: FOUND_WHILE_WORKING_ON_INPUT,
      }),
      run: ({ title, description, projectId, priority, kind, taskId, ...parts }, { sessionId }) =>
        answered(async () => {
          const foundWhile = await this.foundWhileWorkingOn(taskId, sessionId);
          const task = await this.tasks.create(
            {
              title,
              description,
              projectId,
              priority: priority ?? "normal",
              kind: kind ?? "feature",
            },
            await personInSession(this.sessionPeople, sessionId),
            writtenPartsGiven(parts),
            foundWhile === undefined ? {} : { foundWhileWorkingOn: foundWhile.id },
          );
          const created = `Created the Task "${task.title}" (Task ${task.id}) in Backlog in ${task.projectId}${foundWhileWords(foundWhile)}, with no Pipeline yet: the Planner proposes one, or the user chooses one.`;
          return parts.plan === undefined
            ? created
            : `${created} Its Plan and Definition of Done are Not confirmed until the user confirms each on the Task page.`;
        }),
    });
  }

  private registerCreateInitiative(): void {
    this.registry.register({
      name: CREATE_INITIATIVE,
      area: "initiatives",
      description:
        "Creates an Initiative in your name, only when the user asks for one or agrees to it: one outcome reached by Tasks across Projects. It lands being shaped and waits for Confirm, on its page or with confirm_initiative where your Authority allows it, as one shaped from an Idea does. Name in its outcome the Projects it is meant to touch; its Tasks are added in its shaping Thread, with whoever holds Shapes Initiatives.",
      input: z.object({
        title: z.string().describe("One line naming the Initiative."),
        outcome: z
          .string()
          .describe(
            "What must be true once it is done, in plain language, naming the Projects it is meant to touch.",
          ),
      }),
      run: ({ title, outcome }, { sessionId }) =>
        answered(async () => {
          const { initiative, shaping } = await this.initiatives.create(
            { name: title, outcome },
            await personInSession(this.sessionPeople, sessionId),
          );
          return `Created the Initiative "${initiative.name}" (Initiative ${initiative.id}), being shaped: it waits for the user's Confirm on its page. ${shapingThreadWords(shaping)}`;
        }),
    });
  }

  /**
   * The Task a new record was found while working on: the one given, refused plainly when there is
   * none of that id; none for null; left out, the Task the session's Thread is on, and none in a
   * Thread on an Initiative or a chat.
   */
  private async foundWhileWorkingOn(
    given: string | null | undefined,
    sessionId: string,
  ): Promise<Task | undefined> {
    if (given === null) return undefined;
    const taskId = given ?? (await this.sessionTasks.taskInSession(sessionId));
    if (taskId === undefined) return undefined;
    const task = await this.tasks.find(taskId);
    if (task) return task;
    throw new WorkToolRefused(
      given === undefined
        ? `The Task this Thread is on, ${taskId}, can't be read; give taskId, or null for none.`
        : `There is no Task ${taskId}; give a Task's id as list_tasks gives it, or null for none.`,
    );
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
      case "thread":
        return `Attached to a message in Thread ${owner.threadId}.`;
    }
  }
}

interface ReadingAsked {
  readonly fromLine?: number | undefined;
  readonly fromCharacter?: number | undefined;
  readonly lineCount?: number | undefined;
  readonly search?: string | undefined;
  readonly contextLines?: number | undefined;
}

/**
 * A search when a phrase is given, else a slice; a file read by its id alone is its start. A
 * search reads whole lines, so it takes no fromCharacter.
 */
function lineReading({
  fromLine,
  fromCharacter,
  lineCount,
  search,
  contextLines,
}: ReadingAsked): LineReading {
  if (search !== undefined && fromCharacter !== undefined) {
    throw new WorkToolRefused(
      "fromCharacter reads on in one line of a slice; leave it out of a search, or leave out search to read the line on.",
    );
  }
  return search === undefined
    ? {
        kind: "slice",
        fromLine: fromLine ?? 1,
        fromCharacter: fromCharacter ?? 1,
        lineCount: lineCount ?? DEFAULT_LINE_COUNT,
      }
    : {
        kind: "search",
        phrase: search,
        fromLine: fromLine ?? 1,
        contextLines: contextLines ?? DEFAULT_CONTEXT_LINES,
      };
}

/** "1 file", "1,312 files". */
function fileCountWords(count: number): string {
  return count === 1 ? "1 file" : `${count.toLocaleString("en-US")} files`;
}

/** A path's last part, as a picture is named. */
function baseNameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** create_task's and capture_idea's input naming the Task the new record was found while working on. */
const FOUND_WHILE_WORKING_ON_INPUT = z
  .string()
  .nullable()
  .optional()
  .describe(
    "The Task this record was found while working on, by its id; left out, it is the Task this Thread is on, if any; null for none.",
  );

/** ", found while working on <Task> (Task <id>)" when one was set; nothing otherwise. */
function foundWhileWords(task: Task | undefined): string {
  return task === undefined ? "" : `, found while working on "${task.title}" (Task ${task.id})`;
}

function taskLine(task: TaskSummary): string {
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

/** Where the new Initiative is shaped: with whoever holds Shapes Initiatives, or nobody yet. */
function shapingThreadWords({ shaper, opened }: ShapingThreadOpening): string {
  if (!shaper) {
    return "Nobody holds Shapes Initiatives, so its shaping Thread waits: the user chooses who in Settings › Duties, then starts it on its page.";
  }
  return opened
    ? `Its shaping Thread with ${shaper.card.name} is open, where its Tasks are agreed.`
    : `Its shaping Thread with ${shaper.card.name} didn't open: the user starts it on its page.`;
}
