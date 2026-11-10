import { mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { Injectable } from "@nestjs/common";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { AttachmentFiles } from "../../ports/attachment-files.js";

/**
 * `<office-data>/attachments/<attachment id>`: named by the id alone, so what the user called the
 * file never reaches a path, and written whole or not at all. A PDF's text is beside it, in
 * `<attachment id>.pdf-text`.
 */
@Injectable()
export class FilesystemAttachmentFiles extends AttachmentFiles {
  private readonly folder: string;

  constructor(officeData: OfficeDataDirectory) {
    super();
    this.folder = officeData.folder("attachments");
  }

  save(attachmentId: string, content: Uint8Array): Promise<void> {
    return this.writeWhole(this.pathOf(attachmentId), content);
  }

  open(attachmentId: string): Promise<Readable> {
    return openStream(this.pathOf(attachmentId));
  }

  savePdfText(attachmentId: string, text: string): Promise<void> {
    return this.writeWhole(this.pdfTextPathOf(attachmentId), text);
  }

  openPdfText(attachmentId: string): Promise<Readable> {
    return openStream(this.pdfTextPathOf(attachmentId));
  }

  async remove(attachmentId: string): Promise<void> {
    await rm(this.pathOf(attachmentId), { force: true });
    await rm(this.pdfTextPathOf(attachmentId), { force: true });
  }

  private async writeWhole(path: string, content: Uint8Array | string): Promise<void> {
    await mkdir(this.folder, { recursive: true });
    const unfinished = `${path}.unfinished`;
    try {
      await writeFile(unfinished, content);
      await rename(unfinished, path);
    } finally {
      await rm(unfinished, { force: true });
    }
  }

  private pathOf(attachmentId: string): string {
    return join(this.folder, attachmentId);
  }

  private pdfTextPathOf(attachmentId: string): string {
    return `${this.pathOf(attachmentId)}.pdf-text`;
  }
}

async function openStream(path: string): Promise<Readable> {
  const file = await open(path);
  return file.createReadStream();
}
