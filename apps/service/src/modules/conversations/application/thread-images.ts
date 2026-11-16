import { Injectable } from "@nestjs/common";
import { pictureMediaTypeOf } from "../../../platform/images/image-rules.js";
import type { EngineSession } from "../../engine/index.js";
import type { Message, MessageImage } from "../domain/message.js";
import { imageOwnerOf } from "../domain/message-image-owner.js";
import type { Thread } from "../domain/thread.js";
import { ThreadNotFound } from "../domain/thread-not-found.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import type { UserRef } from "../domain/user.js";
import { MessageImageRules } from "../ports/message-image-rules.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { MessageImages } from "./message-images.js";

/** An image of a user message with its bytes, as the engine takes it. */
export type MessageImageContent = NonNullable<
  Parameters<EngineSession["send"]>[0]["images"]
>[number];

/**
 * An image as the user pasted or dropped it into a Thread's message box; the media type the browser
 * gave it is left out, as its bytes tell what it is.
 */
export interface PastedImage {
  readonly name: string;
  readonly content: Uint8Array;
}

/** Why a message names an image that isn't one sent to its Thread. */
export const FOREIGN_IMAGE_PROBLEM =
  "An image the message carries isn't one sent to this Thread: paste it again.";

/**
 * The images the user sends in a Thread's messages (spec §2.4): each is kept as it is pasted, as an
 * Attachment of the Thread's Task or Initiative, or of the Thread itself when it is on neither, and
 * a message carries those it names, which go to the session with it.
 */
@Injectable()
export class ThreadImages {
  constructor(
    private readonly repository: ThreadRepository,
    private readonly images: MessageImages,
    private readonly rules: MessageImageRules,
  ) {}

  /** Why a skill command is refused with images. */
  get skillCommandProblem(): string {
    return this.rules.skillCommandProblem;
  }

  /**
   * Keeps the image for a message of the Thread; refused when it breaks a rule of one image. Its
   * media type is what its bytes are, whatever the browser said: a model refuses an image whose
   * bytes aren't the type it is sent as, and a session holding one fails every turn after.
   */
  async keep(threadId: string, image: PastedImage, addedBy: UserRef): Promise<MessageImage> {
    const thread = await this.repository.find(threadId);
    if (!thread) throw new ThreadNotFound(threadId);
    // A pasted picture may come with no name of its own; an Attachment needs one.
    const name = image.name.trim() || "Pasted image";
    const mediaType = pictureMediaTypeOf(image.content);
    const problem = this.rules.imageProblem({
      name,
      mediaType: mediaType ?? NOT_A_PICTURE,
      size: image.content.byteLength,
    });
    if (problem || !mediaType) throw new ThreadRefused([problem ?? NOT_A_PICTURE]);
    const stored = await this.images.store(imageOwnerOf(thread), {
      name,
      mediaType,
      content: image.content,
      addedBy,
    });
    return { attachmentId: stored.attachmentId, name: stored.name, mediaType: stored.mediaType };
  }

  /**
   * The images a message to the Thread carries, by their ids, in that order: refused when one isn't
   * an image kept for the Thread's owner, or when together they break a message's rules.
   */
  async carried(thread: Thread, attachmentIds: readonly string[]): Promise<MessageImage[]> {
    if (attachmentIds.length === 0) return [];
    const ids = [...new Set(attachmentIds)];
    const owned = await this.images.ownedImages(imageOwnerOf(thread), ids);
    const images = ids.flatMap((id) => {
      const image = owned.get(id);
      return image ? [image] : [];
    });
    if (images.length < ids.length) throw new ThreadRefused([FOREIGN_IMAGE_PROBLEM]);
    const problem = this.rules.imagesProblem(images);
    if (problem) throw new ThreadRefused([problem]);
    return images.map(({ attachmentId, name, mediaType }) => ({ attachmentId, name, mediaType }));
  }

  /** The images' bytes, for the session; one whose Attachment was removed since is left out. */
  async contents(images: readonly MessageImage[]): Promise<MessageImageContent[]> {
    const read = await Promise.all(
      images.map(async ({ attachmentId, name, mediaType }) => {
        const content = await this.images.content(attachmentId);
        return content && { attachmentId, name, mediaType, content };
      }),
    );
    return read.filter((image) => image !== undefined);
  }

  /** The ids of the images the log's user messages carried whose Attachments are gone. */
  async removedIn(log: readonly Message[]): Promise<ReadonlySet<string>> {
    const ids = log.flatMap((message) =>
      message.kind === "user" ? (message.images ?? []).map(({ attachmentId }) => attachmentId) : [],
    );
    if (ids.length === 0) return new Set();
    const existing = await this.images.existing(ids);
    return new Set(ids.filter((id) => !existing.has(id)));
  }
}

/** The media type bytes that are no picture a message carries are judged as. */
const NOT_A_PICTURE = "application/octet-stream";
