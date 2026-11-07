import type { Readable } from "node:stream";

/** The bytes of people's Avatars, each kept under its image's id. */
export abstract class AvatarFiles {
  abstract save(imageId: string, content: Uint8Array): Promise<void>;

  /** Throws when there is no such file. */
  abstract open(imageId: string): Promise<Readable>;

  /** Nothing happens when it isn't there. */
  abstract remove(imageId: string): Promise<void>;
}
