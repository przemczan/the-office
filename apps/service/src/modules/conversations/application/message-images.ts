import { Injectable } from "@nestjs/common";
import type { MessageImageOwner } from "../domain/message-image-owner.js";
import type { UserRef } from "../domain/user.js";

/** An image the user sent in a message, kept as an Attachment of its owner. */
export interface StoredMessageImage {
  readonly attachmentId: string;
  readonly name: string;
  readonly mediaType: string;
  /** In bytes. */
  readonly size: number;
}

/** An image to keep, as the user pasted or dropped it. */
export interface NewMessageImage {
  readonly name: string;
  readonly mediaType: string;
  readonly content: Uint8Array;
  /** The user who sent it; null in a test or a message from before users. */
  readonly addedBy: UserRef | null;
}

/**
 * Where the images of user messages are kept: as Attachments of the Thread's Task or Initiative,
 * or of the Thread itself. The module keeping Attachments registers here, as with `WorkRecords`.
 */
export interface MessageImageSource {
  /** Keeps the image as the owner's Attachment. */
  store(owner: MessageImageOwner, image: NewMessageImage): Promise<StoredMessageImage>;
  /**
   * The images among the ids that are image Attachments of the owner, by id; an id that isn't
   * one is left out.
   */
  ownedImages(
    owner: MessageImageOwner,
    attachmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, StoredMessageImage>>;
  /** An image's bytes; undefined once its Attachment is removed. */
  content(attachmentId: string): Promise<Uint8Array | undefined>;
  /** Which of the ids are Attachments there still are, for the Brief's "Image removed". */
  existing(attachmentIds: readonly string[]): Promise<ReadonlySet<string>>;
}

@Injectable()
export class MessageImages implements MessageImageSource {
  private source: MessageImageSource | undefined;

  provide(source: MessageImageSource): void {
    if (this.source) throw new Error("Message images are kept by one module only.");
    this.source = source;
  }

  store(owner: MessageImageOwner, image: NewMessageImage): Promise<StoredMessageImage> {
    return this.registered().store(owner, image);
  }

  ownedImages(
    owner: MessageImageOwner,
    attachmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, StoredMessageImage>> {
    return this.registered().ownedImages(owner, attachmentIds);
  }

  content(attachmentId: string): Promise<Uint8Array | undefined> {
    return this.registered().content(attachmentId);
  }

  existing(attachmentIds: readonly string[]): Promise<ReadonlySet<string>> {
    return this.registered().existing(attachmentIds);
  }

  private registered(): MessageImageSource {
    if (!this.source) throw new Error("No module keeps message images.");
    return this.source;
  }
}
