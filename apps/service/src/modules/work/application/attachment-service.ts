import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { Injectable, Logger } from "@nestjs/common";
import { EventBus } from "../../../platform/events/event-bus.js";
import { KeyedLocks } from "../../../platform/locks/keyed-locks.js";
import {
  ATTACHMENT_SIZE_LIMIT,
  fileReadingOf,
  isText,
  isTextFile,
  mediaTypeOf,
  zipEntryLine,
  zipEntryReadingOf,
  type Attachment,
  type AttachmentOwner,
  type NewFile,
  type NewLink,
  type StoredFileAttachment,
  type ZipEntry,
} from "../domain/attachment.js";
import {
  addFile,
  addLink,
  attachmentToReplace,
  removeAttachment,
  replaceFile,
  type Adding,
} from "../domain/attachment-changes.js";
import { AttachmentNotFound } from "../domain/attachment-not-found.js";
import { AttachmentRefused } from "../domain/attachment-refused.js";
import type { Author } from "../domain/author.js";
import type { Idea } from "../domain/idea.js";
import { attachingToIdeaProblems } from "../domain/idea-changes.js";
import { IdeaNotFound } from "../domain/idea-not-found.js";
import { InitiativeNotFound } from "../domain/initiative-not-found.js";
import { pdfTextOf } from "../domain/pdf-text.js";
import type { PersonAuthor } from "../domain/state-change.js";
import { SEARCHED_TEXT_LIMIT, searchedText } from "../domain/search.js";
import { TaskNotFound } from "../domain/task-not-found.js";
import { lineReader, type LineReading, type LinesPart } from "../domain/text-lines.js";
import { AttachmentFiles } from "../ports/attachment-files.js";
import { AttachmentRepository } from "../ports/attachment-repository.js";
import { IdeaRepository } from "../ports/idea-repository.js";
import { InitiativeRepository } from "../ports/initiative-repository.js";
import { PdfPages } from "../ports/pdf-pages.js";
import { TaskGates } from "../ports/task-gates.js";
import { TaskRepository } from "../ports/task-repository.js";
import { ZipFiles } from "../ports/zip-files.js";

/** A file as it is uploaded: its name, media type and bytes. */
export interface UploadedFile {
  readonly name: string;
  readonly mediaType: string;
  readonly content: Uint8Array;
}

/** A file an Agent attaches from its Task's worktree, by its path there. */
export interface WorktreeUpload extends UploadedFile {
  /** Relative to the worktree, with "/" between folders. */
  readonly path: string;
}

/** The file an Agent attached from a worktree, and whether it replaced the Agent's earlier copy. */
export interface WorktreeAttaching {
  readonly attachment: StoredFileAttachment;
  readonly replaced: boolean;
}

/** A stored file's Attachment with its bytes to read. */
export interface OpenedFile {
  readonly attachment: StoredFileAttachment;
  readonly content: Readable;
}

/** An image Attachment's picture: its media type and bytes. */
export interface Picture {
  readonly attachment: StoredFileAttachment;
  readonly mediaType: string;
  readonly content: Uint8Array;
}

/** A file in a zip Attachment, read as a file Attachment of its own would be. */
export type ZipEntryRead =
  | {
      readonly reading: "lines" | "pdf-text";
      readonly entry: ZipEntry;
      readonly part: LinesPart;
    }
  | {
      readonly reading: "picture";
      readonly entry: ZipEntry;
      readonly mediaType: string;
      readonly content: Uint8Array;
    }
  | { readonly reading: "unreadable"; readonly entry: ZipEntry };

/**
 * The Attachments use cases. A file's bytes, and a PDF's text, are written before its record and
 * removed after it, so a record never names a file that isn't there; a replaced file's old copy is
 * let go only once its record names the new one.
 */
@Injectable()
export class AttachmentService {
  private readonly logger = new Logger(AttachmentService.name);
  /** One Agent's file at a time per Task, so two copies of one path never both add. */
  private readonly worktreeAttachingLocks = new KeyedLocks();

  constructor(
    private readonly repository: AttachmentRepository,
    private readonly files: AttachmentFiles,
    private readonly pdfPages: PdfPages,
    private readonly zipFiles: ZipFiles,
    private readonly ideas: IdeaRepository,
    private readonly initiatives: InitiativeRepository,
    private readonly tasks: TaskRepository,
    private readonly taskGates: TaskGates,
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
    return this.keepNewFile(await this.adding(owner, addedBy), newFileOf(file, undefined), file);
  }

  /**
   * Attaches a file from the Task's worktree in the person's name, replacing the copy an Agent
   * attached from the same path since the user last acted at a Gate on the Task (spec §2.1).
   */
  async attachFromWorktree(
    taskId: string,
    file: WorktreeUpload,
    addedBy: PersonAuthor,
  ): Promise<WorktreeAttaching> {
    return this.worktreeAttachingLocks.run(taskId, async () => {
      const adding = await this.adding({ kind: "task", taskId }, addedBy);
      const [attachments, lastActedOnGateEnd] = await Promise.all([
        this.repository.listOf(adding.owner),
        this.taskGates.lastActedOnGateEnd(taskId),
      ]);
      const newFile = newFileOf(file, file.path);
      const replaced = attachmentToReplace(attachments, adding, file.path, lastActedOnGateEnd);
      return replaced
        ? {
            attachment: await this.replace(replaced, newFile, adding.addedBy, file),
            replaced: true,
          }
        : { attachment: await this.keepNewFile(adding, newFile, file), replaced: false };
    });
  }

  async read(id: string): Promise<Attachment> {
    const attachment = await this.repository.find(id);
    if (!attachment) throw new AttachmentNotFound(id);
    return attachment;
  }

  /** Those of the ids there are, in no order. */
  async findAll(ids: readonly string[]): Promise<readonly Attachment[]> {
    return this.repository.findAll(ids);
  }

  /** A stored file's bytes, whole; a link is refused. */
  async contentOf(id: string): Promise<Uint8Array> {
    await this.readFile(id);
    return wholeOf(await this.files.open(id));
  }

  /** A link has no file: it opens at its address. */
  async open(id: string): Promise<OpenedFile> {
    const attachment = await this.readFile(id);
    return { attachment, content: await this.files.open(id) };
  }

  /**
   * Reads a text file, or a PDF's text, by its lines (`linesPartOf`). Any other file is refused.
   */
  async readLines(id: string, reading: LineReading, budget: number): Promise<LinesPart> {
    return linesPartOf(await this.linesOf(await this.readFile(id)), reading, budget);
  }

  /**
   * Reads the files a zip holds, one per line with its path and size, as a text file's lines are
   * read; any other Attachment is refused.
   */
  async readZipEntries(id: string, reading: LineReading, budget: number): Promise<LinesPart> {
    const entries = await this.zipFiles.entriesOf(await this.zipOf(id));
    return linesPartOf(Readable.from([entries.map(zipEntryLine).join("\n")]), reading, budget);
  }

  /**
   * Reads one file in a zip, in memory, by what it holds: a text file or a PDF's text by its lines
   * within `budget` characters, an image as a picture. Refused when the zip holds no file at
   * `path`, or the Attachment is no zip.
   */
  async readZipEntry(
    id: string,
    path: string,
    reading: LineReading,
    budget: number,
  ): Promise<ZipEntryRead> {
    const file = await this.zipFiles.contentOf(await this.zipOf(id), path, ATTACHMENT_SIZE_LIMIT);
    if (!file) {
      throw new AttachmentRefused([
        `This zip holds no file "${path}"; read it without entry for the files it holds.`,
      ]);
    }
    const { entry, content } = file;
    const entryReading = zipEntryReadingOf(entry, content);
    switch (entryReading) {
      case "lines":
        return {
          reading: entryReading,
          entry,
          part: await linesPartOf(Readable.from([Buffer.from(content)]), reading, budget),
        };
      case "pdf-text":
        return {
          reading: entryReading,
          entry,
          part: await linesPartOf(Readable.from([await this.pdfTextIn(content)]), reading, budget),
        };
      case "picture":
        return { reading: entryReading, entry, mediaType: mediaTypeOf(entry.path), content };
      case "unreadable":
        return { reading: entryReading, entry };
    }
  }

  /** An image's picture, whole; any other Attachment is refused. */
  async readPicture(id: string): Promise<Picture> {
    const attachment = await this.readFile(id);
    if (fileReadingOf(attachment) !== "picture") {
      throw new AttachmentRefused(["Only an image is read as a picture."]);
    }
    const content = await wholeOf(await this.files.open(id));
    return { attachment, mediaType: attachment.mediaType, content };
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

  /**
   * Judges once whether each file attached before The Office judged files is a text file, and
   * pulls out a PDF's text. One whose file can't be read is left unjudged, for the next start.
   */
  async judgeFilesAttachedBefore(): Promise<void> {
    for (const file of await this.repository.filesNotJudged()) {
      try {
        const content = await wholeOf(await this.files.open(file.id));
        const text = isTextFile(file, isText(content));
        await this.keepPdfText({ ...file, text }, content);
        await this.repository.keepJudgement(file.id, text);
      } catch (error) {
        this.logger.warn(`Could not judge file ${file.id}: ${(error as Error).message}`);
      }
    }
  }

  private async keepNewFile(
    adding: Adding,
    newFile: NewFile,
    { content }: UploadedFile,
  ): Promise<StoredFileAttachment> {
    const { attachment, event } = addFile(randomUUID(), newFile, adding);
    const documentText = await documentTextOf(attachment, content);
    await this.files.save(attachment.id, content);
    try {
      await this.keepPdfText(attachment, content);
      await this.repository.add(attachment, documentText);
    } catch (error) {
      await this.files.remove(attachment.id);
      throw error;
    }
    await this.events.publish(event);
    return attachment;
  }

  private async replace(
    replaced: StoredFileAttachment,
    newFile: NewFile,
    addedBy: Author,
    { content }: UploadedFile,
  ): Promise<StoredFileAttachment> {
    const { attachment, event } = replaceFile(replaced, newFile, addedBy);
    const documentText = await documentTextOf(attachment, content);
    const replacement = await this.files.replace(
      attachment.id,
      content,
      await this.pdfTextFor(attachment, content),
    );
    try {
      await this.repository.replace(attachment, documentText);
    } catch (error) {
      await replacement.undo();
      throw error;
    }
    await replacement.keep().catch((error: unknown) => {
      this.logger.warn(`Could not let go of the old copy of ${attachment.id}: ${String(error)}`);
    });
    await this.events.publish(event);
    return attachment;
  }

  private async readFile(id: string): Promise<StoredFileAttachment> {
    const attachment = await this.read(id);
    if (attachment.kind === "link") {
      throw new AttachmentRefused(["A link has no file; open its address instead."]);
    }
    return attachment;
  }

  private async zipOf(id: string): Promise<Uint8Array> {
    if (fileReadingOf(await this.readFile(id)) !== "zip") {
      throw new AttachmentRefused(["Only a zip is read by the files it holds."]);
    }
    return wholeOf(await this.files.open(id));
  }

  /** The text of a PDF in a zip, pulled out as it is read, as nothing keeps it. */
  private async pdfTextIn(content: Uint8Array): Promise<string> {
    try {
      return pdfTextOf(await this.pdfPages.textOf(content));
    } catch {
      throw new AttachmentRefused([
        "The Office couldn't pull the text out of this PDF, so it can't be read.",
      ]);
    }
  }

  private async linesOf(file: StoredFileAttachment): Promise<Readable> {
    switch (fileReadingOf(file)) {
      case "lines":
        return this.files.open(file.id);
      case "pdf-text":
        try {
          return await this.files.openPdfText(file.id);
        } catch {
          throw new AttachmentRefused([
            "The Office couldn't pull the text out of this PDF, so it can't be read.",
          ]);
        }
      case "picture":
      case "zip":
      case "unreadable":
        throw new AttachmentRefused(["Only a text file or a PDF is read by its lines."]);
    }
  }

  /** Keeps a PDF's text beside it, when it has one (`pdfTextFor`). */
  private async keepPdfText(file: StoredFileAttachment, content: Uint8Array): Promise<void> {
    const text = await this.pdfTextFor(file, content);
    if (text !== undefined) await this.files.savePdfText(file.id, text);
  }

  /**
   * A PDF's text, to keep beside it. A PDF its reader can't open has none, and reads as such: the
   * file is attached either way.
   */
  private async pdfTextFor(
    file: StoredFileAttachment,
    content: Uint8Array,
  ): Promise<string | undefined> {
    if (fileReadingOf(file) !== "pdf-text") return undefined;
    try {
      return pdfTextOf(await this.pdfPages.textOf(content));
    } catch (error) {
      this.logger.warn(`Could not read the PDF ${file.id}: ${(error as Error).message}`);
      return undefined;
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
      case "thread":
        // Threads are Conversations': it stores a message's image only for a Thread it has.
        return undefined;
    }
  }
}

function newFileOf(file: UploadedFile, sourcePath: string | undefined): NewFile {
  return {
    name: file.name,
    mediaType: file.mediaType,
    size: file.content.byteLength,
    text: isText(file.content),
    sourcePath,
  };
}

/** A document's text, for the search. */
async function documentTextOf(
  file: StoredFileAttachment,
  content: Uint8Array,
): Promise<string | undefined> {
  return file.kind === "document" ? searchedTextOf(Readable.from([content])) : undefined;
}

/**
 * Reads a text by its lines, as UTF-8, within `budget` characters. The text is streamed line by
 * line, as it can be far larger than any answer, and every line is counted.
 */
async function linesPartOf(
  content: Readable,
  reading: LineReading,
  budget: number,
): Promise<LinesPart> {
  const reader = lineReader(reading, budget);
  const lines = createInterface({ input: content, crlfDelay: Infinity });
  try {
    for await (const line of lines) reader.take(line);
  } finally {
    lines.close();
    content.destroy();
  }
  return reader.part();
}

async function wholeOf(content: Readable): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  try {
    for await (const chunk of content) chunks.push(chunk as Uint8Array);
  } finally {
    content.destroy();
  }
  return Buffer.concat(chunks);
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
