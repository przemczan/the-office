import type { Readable } from "node:stream";

/**
 * The bytes of Attachments that are files, each kept under its Attachment's id, and beside a PDF
 * the text pulled out of it.
 */
export abstract class AttachmentFiles {
  abstract save(attachmentId: string, content: Uint8Array): Promise<void>;

  /** Throws when there is no such file. */
  abstract open(attachmentId: string): Promise<Readable>;

  abstract savePdfText(attachmentId: string, text: string): Promise<void>;

  /** Throws when no text was kept for it. */
  abstract openPdfText(attachmentId: string): Promise<Readable>;

  /** Removes the file and any text kept beside it; nothing happens when they aren't there. */
  abstract remove(attachmentId: string): Promise<void>;
}
