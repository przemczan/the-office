import { Injectable, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import { CORE_AREA, OfficeToolRegistry } from "../../../engine/index.js";
import { AttachmentService } from "../../application/attachment-service.js";
import { TaskService } from "../../application/task-service.js";
import {
  attachmentKindWords,
  mediaTypeOf,
  type Attachment,
  type AttachmentOwner,
  type StoredFileAttachment,
} from "../../domain/attachment.js";
import type { PersonAuthor } from "../../domain/state-change.js";
import { ProjectWorktrees } from "../../ports/project-worktrees.js";
import { SessionPeople } from "../../ports/session-people.js";
import { SessionTasks } from "../../ports/session-tasks.js";
import { readWorktreeFile } from "../filesystem/worktree-files.js";
import { answered, personInSession, refusalOf, WorkToolRefused } from "./work-tool-answers.js";

export const ATTACH_FILE = "attach_file";

/**
 * The Office tool an Agent attaches a file to a Task with (spec §2.1), in the name of the person in
 * the session, ruled as Work › Task records on that Task: a file from the Task's worktree, such as
 * a screenshot or a report, or an image the user sent in the session's Thread. It is hand-written
 * rather than an Office action, as its route is the user's upload from their device (multipart).
 * `attach_link` is the Office action `WorkOfficeActions` carries out.
 */
@Injectable()
export class AttachmentOfficeTools implements OnModuleInit {
  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly tasks: TaskService,
    private readonly attachments: AttachmentService,
    private readonly worktrees: ProjectWorktrees,
    private readonly sessionTasks: SessionTasks,
    private readonly sessionPeople: SessionPeople,
  ) {}

  onModuleInit(): void {
    const input = z.object({
      taskId: z.uuid().describe("The id of the Task to attach to."),
      path: z
        .string()
        .optional()
        .describe(
          "A file's path, relative to the worktree: in a Thread on the Task only. Give this or attachmentId.",
        ),
      attachmentId: z
        .string()
        .optional()
        .describe(
          "The id of an image the user sent in this Thread, as its message names it. Give this or path.",
        ),
    });
    this.registry.register({
      name: ATTACH_FILE,
      area: CORE_AREA,
      description:
        "Attaches a file to a Task, such as a screenshot, a report or a document (.md), for the user to see with the Task: a file from the Task's worktree (path, in a Thread on the Task), or an image the user sent in this Thread (attachmentId). A design for the user to approve is attached before its Gate, as one self-contained .html file, since the preview loads nothing from outside the file. The Office keeps a copy, so a later change to the file doesn't change the Attachment; attaching the same path again replaces that copy until the user acts at the Task's next Gate.",
      input,
      authority: {
        group: "taskRecords",
        title: "Attach a file to a Task",
        subject: (given) => ({ kind: "task", id: input.parse(given).taskId }),
        check: (given, { sessionId }) =>
          refusalOf(() => this.checkCall(sessionId, input.parse(given))),
      },
      run: ({ taskId, path, attachmentId }, { sessionId, allowedBy }) =>
        answered(async () => {
          exactlyOneSource(path, attachmentId);
          const by = await personInSession(this.sessionPeople, sessionId, allowedBy);
          await this.tasks.read(taskId);
          if (path !== undefined) return this.attachFromWorktree(sessionId, taskId, path, by);
          return this.attachThreadImage(sessionId, taskId, attachmentId ?? "", by);
        }),
    });
  }

  /** The refusals a call meets before it runs or is held, so no approval is spent on them. */
  private async checkCall(
    sessionId: string,
    { taskId, path, attachmentId }: Source,
  ): Promise<void> {
    exactlyOneSource(path, attachmentId);
    await this.tasks.read(taskId);
    if (path !== undefined) await this.inThreadOnTask(sessionId, taskId);
    else await this.imageSentInThread(sessionId, attachmentId ?? "");
  }

  private async inThreadOnTask(sessionId: string, taskId: string): Promise<void> {
    if ((await this.sessionTasks.taskInSession(sessionId)) !== taskId) {
      throw new WorkToolRefused(
        "A worktree file attaches only from a Thread on the Task, whose worktree it is.",
      );
    }
  }

  /** The image Attachment the user sent in the session's Thread, with the record that keeps it. */
  private async imageSentInThread(
    sessionId: string,
    attachmentId: string,
  ): Promise<{
    readonly image: StoredFileAttachment;
    readonly kept: AttachmentOwner;
  }> {
    const [kept, image] = await Promise.all([
      this.sessionTasks.imageOwnerInSession(sessionId),
      this.attachments.read(attachmentId),
    ]);
    if (kept === undefined || image.kind !== "image" || !sameOwner(image.owner, kept)) {
      throw new WorkToolRefused("That isn't an image the user sent in this Thread.");
    }
    return { image, kept };
  }

  private async attachFromWorktree(
    sessionId: string,
    taskId: string,
    path: string,
    by: PersonAuthor,
  ): Promise<string> {
    await this.inThreadOnTask(sessionId, taskId);
    const task = await this.tasks.read(taskId);
    const worktree = await this.worktrees.find(task.projectId, taskId);
    const file = await readWorktreeFile(worktree.path, path);
    const { attachment, replaced } = await this.attachments.attachFromWorktree(
      taskId,
      { ...file, mediaType: mediaTypeOf(file.name) },
      by,
    );
    return replaced ? replacedWords(attachment) : attachedWords(attachment);
  }

  private async attachThreadImage(
    sessionId: string,
    taskId: string,
    attachmentId: string,
    by: PersonAuthor,
  ): Promise<string> {
    const { image, kept } = await this.imageSentInThread(sessionId, attachmentId);
    if (kept.kind === "task" && kept.taskId === taskId) {
      return `${image.name} is an Attachment of the Task already (Attachment ${image.id}).`;
    }
    const attached = await this.attachments.addFile(
      { kind: "task", taskId },
      {
        name: image.name,
        mediaType: image.mediaType,
        content: await this.attachments.contentOf(image.id),
      },
      by,
    );
    return attachedWords(attached);
  }
}

/** Where a call takes its file from: a worktree path or an image sent in the Thread. */
interface Source {
  readonly taskId: string;
  readonly path?: string;
  readonly attachmentId?: string;
}

function exactlyOneSource(path: string | undefined, attachmentId: string | undefined): void {
  if ((path === undefined) === (attachmentId === undefined)) {
    throw new WorkToolRefused("Give exactly one of path and attachmentId.");
  }
}

function sameOwner(first: AttachmentOwner, second: AttachmentOwner): boolean {
  switch (first.kind) {
    case "idea":
      return second.kind === "idea" && second.ideaId === first.ideaId;
    case "initiative":
      return second.kind === "initiative" && second.initiativeId === first.initiativeId;
    case "task":
      return second.kind === "task" && second.taskId === first.taskId;
    case "thread":
      return second.kind === "thread" && second.threadId === first.threadId;
  }
}

function replacedWords(attachment: Attachment): string {
  return `Replaced ${attachment.name} (Attachment ${attachment.id}) with the new copy.`;
}

export function attachedWords(attachment: Attachment): string {
  return `Attached ${attachment.name} (${attachmentKindWords(attachment)}) to the Task as Attachment ${attachment.id}.`;
}
