import type { Readable } from "node:stream";

/** A file's new copy, in place of the old one until it is kept or undone. */
export interface FileReplacement {
  /** Lets the old copy go. */
  keep(): Promise<void>;
  /** Puts the old copy back, with any text kept beside it. */
  undo(): Promise<void>;
}

/**
 * The bytes of Attachments that are files, each kept under its Attachment's id, and beside a PDF
 * the text pulled out of it.
 */
export abstract class AttachmentFiles {
  abstract save(attachmentId: string, content: Uint8Array): Promise<void>;

  /**
   * Puts a new copy in place of the file, with `pdfText` beside it, or none, in place of any the
   * old copy had. Nothing is changed when it throws.
   */
  abstract replace(
    attachmentId: string,
    content: Uint8Array,
    pdfText: string | undefined,
  ): Promise<FileReplacement>;

  /** Throws when there is no such file. */
  abstract open(attachmentId: string): Promise<Readable>;

  abstract savePdfText(attachmentId: string, text: string): Promise<void>;

  /** Throws when no text was kept for it. */
  abstract openPdfText(attachmentId: string): Promise<Readable>;

  /** Removes the file and any text kept beside it; nothing happens when they aren't there. */
  abstract remove(attachmentId: string): Promise<void>;
}
