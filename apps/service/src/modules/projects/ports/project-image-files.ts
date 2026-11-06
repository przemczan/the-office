import type { Readable } from "node:stream";

/** The bytes of Projects' Icons and Logos, each kept under its image's id. */
export abstract class ProjectImageFiles {
  abstract save(imageId: string, content: Uint8Array): Promise<void>;

  /** Throws when there is no such file. */
  abstract open(imageId: string): Promise<Readable>;

  /** Nothing happens when it isn't there. */
  abstract remove(imageId: string): Promise<void>;
}
