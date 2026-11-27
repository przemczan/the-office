import { randomUUID } from "node:crypto";
import type { MessageImageOwner } from "../domain/message-image-owner.js";
import type { MessageImageSource, NewMessageImage, StoredMessageImage } from "./message-images.js";

/** The images a test's messages carry, kept in memory as Work keeps them as Attachments. */
export class MessageImagesInMemory implements MessageImageSource {
  readonly kept = new Map<
    string,
    StoredMessageImage & { readonly owner: MessageImageOwner; readonly content: Uint8Array }
  >();

  store(owner: MessageImageOwner, image: NewMessageImage): Promise<StoredMessageImage> {
    const stored = {
      attachmentId: randomUUID(),
      name: image.name,
      mediaType: image.mediaType,
      size: image.content.byteLength,
    };
    this.kept.set(stored.attachmentId, { ...stored, owner, content: image.content });
    return Promise.resolve(stored);
  }

  /** Keeps an image of `size` bytes for the owner, as an upload would. */
  async keep(owner: MessageImageOwner, name: string, size = 4): Promise<StoredMessageImage> {
    return this.store(owner, {
      name,
      mediaType: "image/png",
      content: new Uint8Array(size).fill(7),
      addedBy: null,
    });
  }

  ownedImages(
    owner: MessageImageOwner,
    attachmentIds: readonly string[],
  ): Promise<ReadonlyMap<string, StoredMessageImage>> {
    const owned = new Map<string, StoredMessageImage>();
    for (const id of attachmentIds) {
      const image = this.kept.get(id);
      if (image && JSON.stringify(image.owner) === JSON.stringify(owner)) {
        const { owner: _owner, content: _content, ...stored } = image;
        owned.set(id, stored);
      }
    }
    return Promise.resolve(owned);
  }

  content(attachmentId: string): Promise<Uint8Array | undefined> {
    return Promise.resolve(this.kept.get(attachmentId)?.content);
  }

  existing(attachmentIds: readonly string[]): Promise<ReadonlySet<string>> {
    return Promise.resolve(new Set(attachmentIds.filter((id) => this.kept.has(id))));
  }

  removeKeptBy(threadId: string): Promise<void> {
    for (const [id, { owner }] of this.kept) {
      if (owner.kind === "thread" && owner.threadId === threadId) this.kept.delete(id);
    }
    return Promise.resolve();
  }

  remove(attachmentId: string): void {
    this.kept.delete(attachmentId);
  }
}
