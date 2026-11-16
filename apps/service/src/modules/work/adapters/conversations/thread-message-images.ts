import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  MessageImages,
  type MessageImageOwner,
  type MessageImageSource,
  type NewMessageImage,
  type StoredMessageImage,
} from "../../../conversations/index.js";
import { AttachmentService } from "../../application/attachment-service.js";
import type { Attachment, StoredFileAttachment } from "../../domain/attachment.js";
import { AttachmentNotFound } from "../../domain/attachment-not-found.js";

/**
 * Keeps the images the user sends in a Thread's messages as image Attachments of the Thread's Task
 * or Initiative, or of the Thread itself, through the same path as any uploaded file, so each is
 * judged, published and read by `read_attachment` like any other.
 */
@Injectable()
export class ThreadMessageImages implements MessageImageSource, OnModuleInit {
  constructor(
    private readonly images: MessageImages,
    private readonly attachments: AttachmentService,
  ) {}

  onModuleInit(): void {
    this.images.provide(this);
  }

  async store(owner: MessageImageOwner, image: NewMessageImage): Promise<StoredMessageImage> {
    const attachment = await this.attachments.addFile(
      owner,
      { name: image.name, mediaType: image.mediaType, content: image.content },
      { kind: "user", user: image.addedBy },
    );
    if (attachment.kind === "link") throw new Error("A stored image came back as a link.");
    return storedImageOf(attachment);
  }

  async ownedImages(
    owner: MessageImageOwner,
    attachmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, StoredMessageImage>> {
    const found = await this.attachments.findAll(attachmentIds);
    return new Map(
      found
        .filter((attachment) => attachment.kind === "image" && sameOwner(attachment, owner))
        .map((image) => [image.id, storedImageOf(image as StoredFileAttachment)]),
    );
  }

  async content(attachmentId: string): Promise<Uint8Array | undefined> {
    try {
      return await this.attachments.contentOf(attachmentId);
    } catch (error) {
      if (error instanceof AttachmentNotFound) return undefined;
      throw error;
    }
  }

  async existing(attachmentIds: readonly string[]): Promise<ReadonlySet<string>> {
    return new Set((await this.attachments.findAll(attachmentIds)).map(({ id }) => id));
  }
}

function storedImageOf(attachment: StoredFileAttachment): StoredMessageImage {
  return {
    attachmentId: attachment.id,
    name: attachment.name,
    mediaType: attachment.mediaType,
    size: attachment.size,
  };
}

function sameOwner({ owner }: Attachment, other: MessageImageOwner): boolean {
  switch (owner.kind) {
    case "idea":
      return false;
    case "initiative":
      return other.kind === "initiative" && other.initiativeId === owner.initiativeId;
    case "task":
      return other.kind === "task" && other.taskId === owner.taskId;
    case "thread":
      return other.kind === "thread" && other.threadId === owner.threadId;
  }
}
