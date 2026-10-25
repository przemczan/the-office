import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { Injectable } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { Attachment, AttachmentOwner, NewLink } from "../domain/attachment.js";
import { addFile, addLink, removeAttachment, type Adding } from "../domain/attachment-changes.js";
import { AttachmentNotFound } from "../domain/attachment-not-found.js";
import { AttachmentRefused } from "../domain/attachment-refused.js";
import type { Author } from "../domain/author.js";
import type { Idea } from "../domain/idea.js";
import { attachingToIdeaProblems } from "../domain/idea-changes.js";
import { IdeaNotFound } from "../domain/idea-not-found.js";
import { TaskNotFound } from "../domain/task-not-found.js";
import { AttachmentFiles } from "../ports/attachment-files.js";
import { AttachmentRepository } from "../ports/attachment-repository.js";
import { IdeaRepository } from "../ports/idea-repository.js";
import { TaskRepository } from "../ports/task-repository.js";

/** A file as it is uploaded: its name, media type and bytes. */
export interface UploadedFile {
  readonly name: string;
  readonly mediaType: string;
  readonly content: Uint8Array;
}

/** A stored file's Attachment with its bytes to read. */
export interface OpenedFile {
  readonly attachment: Attachment;
  readonly content: Readable;
}

/**
 * The Attachments use cases. A file's bytes are written before its record and removed after it,
 * so a record never names a file that isn't there.
 */
@Injectable()
export class AttachmentService {
  constructor(
    private readonly repository: AttachmentRepository,
    private readonly files: AttachmentFiles,
    private readonly ideas: IdeaRepository,
    private readonly tasks: TaskRepository,
    private readonly events: EventBus,
  ) {}

  /** Throws IdeaNotFound or TaskNotFound when the owner isn't there. */
  async listOf(owner: AttachmentOwner): Promise<readonly Attachment[]> {
    await this.checkOwner(owner);
    return this.repository.listOf(owner);
  }

  async addLink(owner: AttachmentOwner, link: NewLink, addedBy: Author): Promise<Attachment> {
    const adding = await this.adding(owner, addedBy);
    const { attachment, event } = addLink(randomUUID(), link, adding);
    await this.repository.add(attachment);
    await this.events.publish(event);
    return attachment;
  }

  async addFile(owner: AttachmentOwner, file: UploadedFile, addedBy: Author): Promise<Attachment> {
    const adding = await this.adding(owner, addedBy);
    const { attachment, event } = addFile(
      randomUUID(),
      { name: file.name, mediaType: file.mediaType, size: file.content.byteLength },
      adding,
    );
    await this.files.save(attachment.id, file.content);
    try {
      await this.repository.add(attachment);
    } catch (error) {
      await this.files.remove(attachment.id);
      throw error;
    }
    await this.events.publish(event);
    return attachment;
  }

  async read(id: string): Promise<Attachment> {
    const attachment = await this.repository.find(id);
    if (!attachment) throw new AttachmentNotFound(id);
    return attachment;
  }

  /** A link has no file: it opens at its address. */
  async open(id: string): Promise<OpenedFile> {
    const attachment = await this.read(id);
    if (attachment.kind === "link") {
      throw new AttachmentRefused(["A link has no file; open its address instead."]);
    }
    return { attachment, content: await this.files.open(id) };
  }

  async remove(id: string): Promise<void> {
    const attachment = await this.read(id);
    await this.repository.remove(id);
    if (attachment.kind !== "link") await this.files.remove(id);
    await this.events.publish(removeAttachment(attachment));
  }

  /** A shaped Idea's Attachments went to its Task, so it takes no more. */
  private async adding(owner: AttachmentOwner, addedBy: Author): Promise<Adding> {
    const idea = await this.checkOwner(owner);
    const problems = idea ? attachingToIdeaProblems(idea) : [];
    if (problems.length > 0) throw new AttachmentRefused(problems);
    return { owner, addedBy, addedAt: new Date() };
  }

  /** The owner when it is an Idea; throws IdeaNotFound or TaskNotFound when it isn't there. */
  private async checkOwner(owner: AttachmentOwner): Promise<Idea | undefined> {
    if (owner.kind === "task") {
      if (!(await this.tasks.find(owner.taskId))) throw new TaskNotFound(owner.taskId);
      return undefined;
    }
    const idea = await this.ideas.find(owner.ideaId);
    if (!idea) throw new IdeaNotFound(owner.ideaId);
    return idea;
  }
}
