import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { Injectable, Logger } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { Attachment, AttachmentOwner, NewLink } from "../domain/attachment.js";
import { addFile, addLink, removeAttachment, type Adding } from "../domain/attachment-changes.js";
import { AttachmentNotFound } from "../domain/attachment-not-found.js";
import { AttachmentRefused } from "../domain/attachment-refused.js";
import type { Author } from "../domain/author.js";
import type { Idea } from "../domain/idea.js";
import {
  documentReader,
  type DocumentPart,
  type DocumentReading,
} from "../domain/document-lines.js";
import { attachingToIdeaProblems } from "../domain/idea-changes.js";
import { IdeaNotFound } from "../domain/idea-not-found.js";
import { InitiativeNotFound } from "../domain/initiative-not-found.js";
import { SEARCHED_TEXT_LIMIT, searchedText } from "../domain/search.js";
import { TaskNotFound } from "../domain/task-not-found.js";
import { AttachmentFiles } from "../ports/attachment-files.js";
import { AttachmentRepository } from "../ports/attachment-repository.js";
import { IdeaRepository } from "../ports/idea-repository.js";
import { InitiativeRepository } from "../ports/initiative-repository.js";
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
  private readonly logger = new Logger(AttachmentService.name);

  constructor(
    private readonly repository: AttachmentRepository,
    private readonly files: AttachmentFiles,
    private readonly ideas: IdeaRepository,
    private readonly initiatives: InitiativeRepository,
    private readonly tasks: TaskRepository,
    private readonly events: EventBus,
  ) {}

  /** Throws the owner's kind's NotFound when it isn't there. */
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
    const text =
      attachment.kind === "document"
        ? await searchedTextOf(Readable.from([file.content]))
        : undefined;
    await this.files.save(attachment.id, file.content);
    try {
      await this.repository.add(attachment, text);
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

  /**
   * Reads a document by its lines, as UTF-8, within `budget` characters. The file is streamed line
   * by line, as a document can be far larger than any answer, and every line is counted.
   */
  async readDocument(id: string, reading: DocumentReading, budget: number): Promise<DocumentPart> {
    const attachment = await this.read(id);
    if (attachment.kind !== "document") {
      throw new AttachmentRefused(["Only a document is read as text."]);
    }
    const reader = documentReader(reading, budget);
    const content = await this.files.open(id);
    const lines = createInterface({ input: content, crlfDelay: Infinity });
    try {
      for await (const line of lines) reader.take(line);
    } finally {
      lines.close();
      content.destroy();
    }
    return reader.part();
  }

  async remove(id: string): Promise<void> {
    const attachment = await this.read(id);
    await this.repository.remove(id);
    if (attachment.kind !== "link") await this.files.remove(id);
    await this.events.publish(removeAttachment(attachment));
  }

  /**
   * Keeps the text of each document added before the search read documents. One whose file can't
   * be read is left without, to be read again at the next start.
   */
  async fillDocumentTexts(): Promise<void> {
    for (const document of await this.repository.documentsWithoutText()) {
      try {
        const text = await searchedTextOf(await this.files.open(document.id));
        await this.repository.keepDocumentText(document.id, text);
      } catch (error) {
        this.logger.warn(`Could not read document ${document.id}: ${(error as Error).message}`);
      }
    }
  }

  /** A shaped Idea's Attachments went to what it became, so it takes no more. */
  private async adding(owner: AttachmentOwner, addedBy: Author): Promise<Adding> {
    const idea = await this.checkOwner(owner);
    const problems = idea ? attachingToIdeaProblems(idea) : [];
    if (problems.length > 0) throw new AttachmentRefused(problems);
    return { owner, addedBy, addedAt: new Date() };
  }

  /** The owner when it is an Idea; throws its kind's NotFound when it isn't there. */
  private async checkOwner(owner: AttachmentOwner): Promise<Idea | undefined> {
    switch (owner.kind) {
      case "idea": {
        const idea = await this.ideas.find(owner.ideaId);
        if (!idea) throw new IdeaNotFound(owner.ideaId);
        return idea;
      }
      case "initiative":
        if (!(await this.initiatives.find(owner.initiativeId))) {
          throw new InitiativeNotFound(owner.initiativeId);
        }
        return undefined;
      case "task":
        if (!(await this.tasks.find(owner.taskId))) throw new TaskNotFound(owner.taskId);
        return undefined;
    }
  }
}

async function searchedTextOf(content: Readable): Promise<string> {
  return searchedText(await leadingText(content, SEARCHED_TEXT_LIMIT));
}

/** Reads no more of the file than it needs, and never ends on half a character. */
async function leadingText(content: Readable, byteLimit: number): Promise<string> {
  const decoder = new TextDecoder("utf-8");
  let text = "";
  let bytesRead = 0;
  try {
    for await (const chunk of content) {
      const bytes = chunk as Uint8Array;
      const room = byteLimit - bytesRead;
      text += decoder.decode(bytes.subarray(0, room), { stream: true });
      bytesRead += Math.min(bytes.byteLength, room);
      if (bytes.byteLength > room) return text;
    }
  } finally {
    content.destroy();
  }
  return text + decoder.decode();
}
