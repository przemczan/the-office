import type { Attachment, AttachmentOwner } from "../domain/attachment.js";

/** Where Attachments' records are kept; a stored file's bytes are with AttachmentFiles. */
export abstract class AttachmentRepository {
  abstract add(attachment: Attachment): Promise<void>;

  abstract find(id: string): Promise<Attachment | undefined>;

  /** The owner's Attachments, in the order they were added. */
  abstract listOf(owner: AttachmentOwner): Promise<readonly Attachment[]>;

  /** Nothing happens when it isn't there. */
  abstract remove(id: string): Promise<void>;
}
