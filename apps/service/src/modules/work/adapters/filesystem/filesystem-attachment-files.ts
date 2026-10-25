import { mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { Injectable } from "@nestjs/common";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { AttachmentFiles } from "../../ports/attachment-files.js";

/**
 * `<office-data>/attachments/<attachment id>`: named by the id alone, so what the user called the
 * file never reaches a path, and written whole or not at all.
 */
@Injectable()
export class FilesystemAttachmentFiles extends AttachmentFiles {
  private readonly folder: string;

  constructor(officeData: OfficeDataDirectory) {
    super();
    this.folder = officeData.folder("attachments");
  }

  async save(attachmentId: string, content: Uint8Array): Promise<void> {
    await mkdir(this.folder, { recursive: true });
    const unfinished = `${this.pathOf(attachmentId)}.unfinished`;
    try {
      await writeFile(unfinished, content);
      await rename(unfinished, this.pathOf(attachmentId));
    } finally {
      await rm(unfinished, { force: true });
    }
  }

  async open(attachmentId: string): Promise<Readable> {
    const file = await open(this.pathOf(attachmentId));
    return file.createReadStream();
  }

  async remove(attachmentId: string): Promise<void> {
    await rm(this.pathOf(attachmentId), { force: true });
  }

  private pathOf(attachmentId: string): string {
    return join(this.folder, attachmentId);
  }
}
