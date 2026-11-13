import type { Attachment, AttachmentOwner, StoredFileAttachment } from "../domain/attachment.js";

/**
 * Where Attachments' records are kept, with a document's text for the search; a stored file's
 * bytes are with AttachmentFiles.
 */
export abstract class AttachmentRepository {
  /** Keeps `documentText` with it, for a document. */
  abstract add(attachment: Attachment, documentText?: string): Promise<void>;

  /**
   * Keeps a file's new copy over its record, its id's, with `documentText` in place of any text
   * kept for the old copy.
   */
  abstract replace(file: StoredFileAttachment, documentText?: string): Promise<void>;

  abstract find(id: string): Promise<Attachment | undefined>;

  /** The owner's Attachments, in the order they were added. */
  abstract listOf(owner: AttachmentOwner): Promise<readonly Attachment[]>;

  /** Documents added before their text was kept, which have none yet. */
  abstract documentsWithoutText(): Promise<readonly Attachment[]>;

  /** Keeps a document's text, unless it has one already. */
  abstract keepDocumentText(attachmentId: string, text: string): Promise<void>;

  /** Files attached before The Office judged whether a file is text, which it hasn't yet. */
  abstract filesNotJudged(): Promise<readonly StoredFileAttachment[]>;

  /** Keeps whether a file attached before is a text file, unless it was judged already. */
  abstract keepJudgement(attachmentId: string, text: boolean): Promise<void>;

  /** Nothing happens when it isn't there. */
  abstract remove(id: string): Promise<void>;
}
