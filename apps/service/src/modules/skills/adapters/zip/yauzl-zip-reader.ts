import type { Readable } from "node:stream";
import { Injectable } from "@nestjs/common";
import { fromBufferPromise, getFileNameLowLevel, type Entry } from "yauzl";
import { SkillRefused } from "../../domain/skill-refused.js";
import { UPLOAD_LIMITS, uploadTooLarge, type FolderEntry } from "../../domain/skill-upload.js";
import { ZipReader } from "../../ports/zip-reader.js";

/** The file type bits of a Unix mode, which zips made on Unix keep in the high 16 bits. */
const UNIX_TYPE = 0o170000;
const UNIX_LINK = 0o120000;
const UNIX_FOLDER = 0o040000;
const UNIX_FILE = 0o100000;
/** The attributes zips made on Windows keep in the low bits instead. */
const DOS_FOLDER = 0x10;
const DOS_REPARSE_POINT = 0x400;

/**
 * yauzl, with names decoded here rather than checked by yauzl, so a path out of the folder is
 * refused in the library's words with every other problem.
 */
@Injectable()
export class YauzlZipReader extends ZipReader {
  async entries(zip: Uint8Array): Promise<readonly FolderEntry[]> {
    const zipFile = await fromBufferPromise(Buffer.from(zip), {
      decodeStrings: false,
      validateEntrySizes: true,
    }).catch(() => {
      throw unreadable();
    });
    try {
      if (zipFile.entryCount > UPLOAD_LIMITS.files) throw new SkillRefused([uploadTooLarge()]);
      const entries: FolderEntry[] = [];
      let bytes = 0;
      for await (const entry of zipFile.eachEntry()) {
        const path = getFileNameLowLevel(
          entry.generalPurposeBitFlag,
          entry.fileNameRaw,
          entry.extraFields,
          false,
        );
        const kind = kindOf(entry, path);
        if (kind !== "file") {
          entries.push({ kind, path });
          continue;
        }
        if (entry.isEncrypted()) throw new SkillRefused([`"${path}" is encrypted.`]);
        bytes += entry.uncompressedSize;
        if (bytes > UPLOAD_LIMITS.bytes) throw new SkillRefused([uploadTooLarge()]);
        const content = await contentOf(await zipFile.openReadStreamPromise(entry));
        entries.push({ kind, path, content });
      }
      return entries;
    } catch (error) {
      throw error instanceof SkillRefused ? error : unreadable();
    } finally {
      zipFile.close();
    }
  }
}

function unreadable(): SkillRefused {
  return new SkillRefused(["The upload is no zip that can be read."]);
}

function kindOf(entry: Entry, path: string): FolderEntry["kind"] {
  const unixType = (entry.externalFileAttributes >>> 16) & UNIX_TYPE;
  if (unixType !== 0) {
    if (unixType === UNIX_LINK) return "link";
    if (unixType === UNIX_FOLDER) return "folder";
    return unixType === UNIX_FILE ? "file" : "other";
  }
  const dosAttributes = entry.externalFileAttributes & 0xffff;
  if (dosAttributes & DOS_REPARSE_POINT) return "link";
  return dosAttributes & DOS_FOLDER || path.endsWith("/") ? "folder" : "file";
}

/** yauzl checks the size as it reads, so an entry can't unpack to more than it declared. */
async function contentOf(stream: Readable): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return new Uint8Array(Buffer.concat(chunks));
}
