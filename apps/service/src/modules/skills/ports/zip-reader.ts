import type { ZipEntry } from "../domain/skill-upload.js";

/** Reads an uploaded zip in memory, never writing it out, so a link in it is never made. */
export abstract class ZipReader {
  /**
   * Every entry, with its path as the zip names it (`/` between folders). Throws SkillRefused
   * when it is no zip it can read, or holds more than `UPLOAD_LIMITS`.
   */
  abstract entries(zip: Uint8Array): Promise<readonly ZipEntry[]>;
}
