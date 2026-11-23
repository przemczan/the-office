import type { ZipEntry } from "../domain/attachment.js";

/**
 * Reads a zip Attachment's files in memory, never unpacking them to disk, so a path or a link in
 * it can't reach outside. Throws AttachmentRefused, in words an Agent can act on, when it is no
 * zip it can read.
 */
export abstract class ZipFiles {
  /** Every file it holds, in the zip's order; folders are left out. */
  abstract entriesOf(zip: Uint8Array): Promise<readonly ZipEntry[]>;

  /**
   * One file's bytes, unpacked; `undefined` when the zip holds no file at that path. Refused when
   * it is encrypted or unpacks to more than `sizeLimit` bytes.
   */
  abstract contentOf(
    zip: Uint8Array,
    path: string,
    sizeLimit: number,
  ): Promise<{ readonly entry: ZipEntry; readonly content: Uint8Array } | undefined>;
}
