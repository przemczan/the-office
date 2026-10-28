import type { Attachment, AttachmentOwner } from "../domain/attachment.js";

/**
 * Where Attachments' records are kept, with a document's text for the search; a stored file's
 * bytes are with AttachmentFiles.
 */
export abstract class AttachmentRepository {
  /** Keeps `documentText` with it, for a document. */
  abstract add(attachment: Attachment, documentText?: string): Promise<void>;

  abstract find(id: string): Promise<Attachment | undefined>;

  /** The owner's Attachments, in the order they were added. */
  abstract listOf(owner: AttachmentOwner): Promise<readonly Attachment[]>;

  /** Documents added before their text was kept, which have none yet. */
  abstract documentsWithoutText(): Promise<readonly Attachment[]>;

  /** Keeps a document's text, unless it has one already. */
  abstract keepDocumentText(attachmentId: string, text: string): Promise<void>;

  /** Nothing happens when it isn't there. */
  abstract remove(id: string): Promise<void>;
}
