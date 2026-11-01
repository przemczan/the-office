import { Injectable, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { AttachmentService } from "../../application/attachment-service.js";
import { PlanningService } from "../../application/planning-service.js";
import { TaskService } from "../../application/task-service.js";
import { attachmentKindWords, type Attachment } from "../../domain/attachment.js";
import { AttachmentNotFound } from "../../domain/attachment-not-found.js";
import { SessionTasks } from "../../ports/session-tasks.js";
import { answered, WorkToolRefused } from "./work-tool-answers.js";

export const WRITE_PLAN = "write_plan";
export const WRITE_DEFINITION_OF_DONE = "write_definition_of_done";
export const PROPOSE_PIPELINE = "propose_pipeline";
export const READ_ATTACHMENT = "read_attachment";
export const WRITE_TAGS = "write_tags";

/**
 * How much of a document read_attachment answers with, so one large file can't fill the session's
 * context; about 15k tokens of English.
 */
export const DOCUMENT_READ_LIMIT = 60_000;

const PROPOSED =
  "It shows on the Task as proposed until the user confirms or edits it; end your turn when you want them to look at it.";

/**
 * The Office tools the Planner plans a Task with, in a Thread on it (spec §2.1, §2.3): each writes
 * onto the session's own Task as proposed, for the user to confirm, but for write_tags, whose Tags
 * apply at once; read_attachment reads its Attachments.
 */
@Injectable()
export class PlanningOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly planning: PlanningService,
    private readonly tasks: TaskService,
    private readonly attachments: AttachmentService,
    private readonly sessionTasks: SessionTasks,
  ) {}

  onModuleInit(): void {
    this.registerWritePlan();
    this.registerWriteDefinitionOfDone();
    this.registerProposePipeline();
    this.registerReadAttachment();
    this.registerWriteTags();
  }

  private registerWritePlan(): void {
    this.registry.register({
      name: WRITE_PLAN,
      description: `Writes the Plan onto this Task: how it will be done, in plain words whoever implements it can follow, with the files it expects to change. It replaces the Plan the Task has; read the Task with read_task first, since the user may have edited it. Start warns the user when a Task in progress in the same Project expects to change some of the same files. ${PROPOSED}`,
      input: z.object({
        plan: z.string().describe("The whole Plan, as Markdown."),
        filesToChange: z
          .array(z.string())
          .optional()
          .describe(
            "The files and folders the Plan expects to change, as paths from the repository's root; a folder covers everything under it. Left out, the Task keeps those it has.",
          ),
        estimatedTokens: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "The tokens (input, output and cache writes) you expect the whole Pipeline to use, every Stage together; shown with the Plan, and the Task's Usage estimate until the Office has done enough Tasks like it. Left out, the Task keeps the one it has.",
          ),
      }),
      run: ({ plan, filesToChange, estimatedTokens }, { sessionId }) =>
        answered(async () => {
          await this.planning.proposePlan(await this.taskIn(sessionId), {
            plan,
            filesToChange,
            estimatedTokens,
          });
          return `Wrote the Plan onto the Task. ${PROPOSED}`;
        }),
    });
  }

  private registerWriteDefinitionOfDone(): void {
    this.registry.register({
      name: WRITE_DEFINITION_OF_DONE,
      description: `Writes the Definition of Done onto this Task: what must be true when it is done, one plain-language statement each that can be checked. It replaces the Definition of Done the Task has; read the Task with read_task first, since the user may have edited it. ${PROPOSED}`,
      input: z.object({
        statements: z
          .array(z.string())
          .describe("Every statement of the Definition of Done, one line each."),
      }),
      run: ({ statements }, { sessionId }) =>
        answered(async () => {
          await this.planning.proposeDefinitionOfDone(await this.taskIn(sessionId), statements);
          return `Wrote the Definition of Done onto the Task. ${PROPOSED}`;
        }),
    });
  }

  private registerProposePipeline(): void {
    this.registry.register({
      name: PROPOSE_PIPELINE,
      description:
        "Proposes the Pipeline this Task's work follows, one of those your Brief lists, chosen from the Definition of Done. The Task keeps its Pipeline until the user confirms yours or chooses another.",
      input: z.object({
        pipelineId: z.string().describe("The Pipeline's id, as your Brief lists it."),
        why: z.string().describe("Why it fits the Definition of Done, in a sentence."),
      }),
      run: ({ pipelineId, why }, { sessionId }) =>
        answered(async () => {
          await this.planning.proposePipeline(await this.taskIn(sessionId), {
            pipelineId,
            reason: why,
          });
          return `Proposed the Pipeline ${pipelineId}. The Task follows it once the user confirms it.`;
        }),
    });
  }

  private registerReadAttachment(): void {
    this.registry.register({
      name: READ_ATTACHMENT,
      description:
        "Reads one of this Task's Attachments: a document's text, a link's address, and an image's or other file's name and kind, since only a document is read as text.",
      input: z.object({
        attachmentId: z
          .string()
          .describe("The Attachment's id, as your Brief or read_task lists it."),
      }),
      run: ({ attachmentId }, { sessionId }) =>
        answered(async () => {
          const taskId = await this.taskIn(sessionId);
          const attachment = await this.attachments.read(attachmentId);
          if (attachment.owner.kind !== "task" || attachment.owner.taskId !== taskId) {
            throw new AttachmentNotFound(attachmentId);
          }
          return this.readingOf(attachment);
        }),
    });
  }

  private registerWriteTags(): void {
    this.registry.register({
      name: WRITE_TAGS,
      description:
        "Sets this Task's Tags: a few short words the user finds and filters Tasks by, such as its area or kind. It replaces the Tags the Task has; each is kept lower-case, spaces made hyphens. They apply at once, and the user can change them.",
      input: z.object({
        tags: z.array(z.string()).describe("Every Tag the Task should have, one word each."),
      }),
      run: ({ tags }, { sessionId }) =>
        answered(async () => {
          const task = await this.tasks.changeTags(await this.taskIn(sessionId), tags);
          const inUse = (await this.tasks.tagsInUse()).filter((tag) => !task.tags.includes(tag));
          const now =
            task.tags.length > 0
              ? `The Task's Tags are now ${task.tags.join(", ")}.`
              : "The Task has no Tags now.";
          return inUse.length > 0 ? `${now} Other Tags in use: ${inUse.join(", ")}.` : now;
        }),
    });
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

  private async taskIn(sessionId: string): Promise<string> {
    const taskId = await this.sessionTasks.taskInSession(sessionId);
    if (taskId === undefined) {
      throw new WorkToolRefused(
        "This tool works in a Thread on a Task, and this session is on none.",
      );
    }
    return taskId;
  }
}
