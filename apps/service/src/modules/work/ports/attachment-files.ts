import type { Readable } from "node:stream";

/** The bytes of Attachments that are files, each kept under its Attachment's id. */
export abstract class AttachmentFiles {
  abstract save(attachmentId: string, content: Uint8Array): Promise<void>;

  /** Throws when there is no such file. */
  abstract open(attachmentId: string): Promise<Readable>;

  /** Nothing happens when it isn't there. */
  abstract remove(attachmentId: string): Promise<void>;
}
