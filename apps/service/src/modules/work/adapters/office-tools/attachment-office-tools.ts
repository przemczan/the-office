import { Injectable, type OnModuleInit } from "@nestjs/common";
import { z } from "zod";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { AttachmentService } from "../../application/attachment-service.js";
import { TaskService } from "../../application/task-service.js";
import { attachmentKindWords, mediaTypeOf, type Attachment } from "../../domain/attachment.js";
import type { Author } from "../../domain/author.js";
import { ProjectWorktrees } from "../../ports/project-worktrees.js";
import { SessionPeople } from "../../ports/session-people.js";
import { SessionTasks } from "../../ports/session-tasks.js";
import { readWorktreeFile } from "../filesystem/worktree-files.js";
import { answered, WorkToolRefused } from "./work-tool-answers.js";

export const ATTACH_FILE = "attach_file";
export const ATTACH_LINK = "attach_link";

/**
 * The Office tools an Agent attaches to the Task it works on with (spec §2.1): a file from the
 * Task's worktree, such as a screenshot or a report, or a link, each in the name of the person in
 * the session. The user sees it with the Task's Attachments.
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
    this.registerAttachFile();
    this.registerAttachLink();
  }

  private registerAttachFile(): void {
    this.registry.register({
      name: ATTACH_FILE,
      description:
        "Attaches a file from the Task's worktree to the Task, such as a screenshot, a report or a document (.md), for the user to see with the Task. A design for the user to approve is attached before its Gate, as one self-contained .html file, since the preview loads nothing from outside the file. The Office keeps a copy, so a later change to the file doesn't change the Attachment.",
      input: z.object({
        path: z.string().describe("The file's path, relative to the worktree."),
      }),
      run: ({ path }, { sessionId }) =>
        answered(async () => {
          const { taskId, addedBy } = await this.attaching(sessionId);
          const task = await this.tasks.read(taskId);
          const worktree = await this.worktrees.find(task.projectId, taskId);
          const file = await readWorktreeFile(worktree.path, path);
          const attachment = await this.attachments.addFile(
            { kind: "task", taskId },
            { ...file, mediaType: mediaTypeOf(file.name) },
            addedBy,
          );
          return attachedWords(attachment);
        }),
    });
  }

  private registerAttachLink(): void {
    this.registry.register({
      name: ATTACH_LINK,
      description:
        "Attaches a link to the Task, such as a page you used or a preview of the work, for the user to see with the Task.",
      input: z.object({
        url: z.string().describe("The web address, starting http:// or https://."),
        name: z.string().optional().describe("What the link is, in a few words."),
      }),
      run: ({ url, name }, { sessionId }) =>
        answered(async () => {
          const { taskId, addedBy } = await this.attaching(sessionId);
          const attachment = await this.attachments.addLink(
            { kind: "task", taskId },
            { url, name: name ?? "" },
            addedBy,
          );
          return attachedWords(attachment);
        }),
    });
  }

  /** The Task the session works on, and the person attaching in it. */
  private async attaching(
    sessionId: string,
  ): Promise<{ readonly taskId: string; readonly addedBy: Author }> {
    const [taskId, roleKey] = await Promise.all([
      this.sessionTasks.taskInSession(sessionId),
      this.sessionPeople.personInSession(sessionId),
    ]);
    if (taskId === undefined || roleKey === undefined) {
      throw new WorkToolRefused(
        "This tool works in a Thread on a Task, and this session is on none.",
      );
    }
    return { taskId, addedBy: { kind: "person", roleKey } };
  }
}

function attachedWords(attachment: Attachment): string {
  return `Attached ${attachment.name} (${attachmentKindWords(attachment)}) to the Task as Attachment ${attachment.id}.`;
}
