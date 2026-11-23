import type { Readable } from "node:stream";
import { Injectable } from "@nestjs/common";
import { fromBufferPromise, getFileNameLowLevel, type Entry, type ZipFile } from "yauzl";
import { AttachmentRefused } from "../../domain/attachment-refused.js";
import type { ZipEntry } from "../../domain/attachment.js";
import { ZipFiles } from "../../ports/zip-files.js";

/**
 * yauzl, with names decoded here rather than checked by yauzl: nothing is written out, so a path
 * out of the folder is only a name, and the zip's other files stay readable.
 */
@Injectable()
export class YauzlZipFiles extends ZipFiles {
  async entriesOf(zip: Uint8Array): Promise<readonly ZipEntry[]> {
    return this.withZip(zip, async (zipFile) => {
      const entries: ZipEntry[] = [];
      for await (const entry of zipFile.eachEntry()) {
        const path = pathOf(entry);
        if (!isFolder(path)) entries.push({ path, size: entry.uncompressedSize });
      }
      return entries;
    });
  }

  async contentOf(
    zip: Uint8Array,
    path: string,
    sizeLimit: number,
  ): Promise<{ readonly entry: ZipEntry; readonly content: Uint8Array } | undefined> {
    return this.withZip(zip, async (zipFile) => {
      for await (const entry of zipFile.eachEntry()) {
        if (pathOf(entry) !== path || isFolder(path)) continue;
        if (entry.isEncrypted()) {
          throw new AttachmentRefused([`"${path}" in this zip is encrypted, so it can't be read.`]);
        }
        if (entry.uncompressedSize > sizeLimit) {
          throw new AttachmentRefused([
            `"${path}" in this zip unpacks to ${entry.uncompressedSize} bytes, more than the ${sizeLimit} The Office reads.`,
          ]);
        }
        const content = await contentOf(await zipFile.openReadStreamPromise(entry));
        return { entry: { path, size: entry.uncompressedSize }, content };
      }
      return undefined;
    });
  }

  private async withZip<T>(zip: Uint8Array, read: (zipFile: ZipFile) => Promise<T>): Promise<T> {
    const zipFile = await fromBufferPromise(Buffer.from(zip), {
      decodeStrings: false,
      validateEntrySizes: true,
    }).catch(() => {
      throw unreadable();
    });
    try {
      return await read(zipFile);
    } catch (error) {
      throw error instanceof AttachmentRefused ? error : unreadable();
    } finally {
      zipFile.close();
    }
  }
}

function unreadable(): AttachmentRefused {
  return new AttachmentRefused(["The Office can't open this zip, so it can't be read."]);
}

function pathOf(entry: Entry): string {
  return getFileNameLowLevel(
    entry.generalPurposeBitFlag,
    entry.fileNameRaw,
    entry.extraFields,
    false,
  );
}

function isFolder(path: string): boolean {
  return path.endsWith("/");
}

/** yauzl checks the size as it reads, so a file can't unpack to more than it declared. */
async function contentOf(stream: Readable): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return new Uint8Array(Buffer.concat(chunks));
}
