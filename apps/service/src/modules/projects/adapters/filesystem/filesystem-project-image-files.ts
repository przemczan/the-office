import { mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { Injectable } from "@nestjs/common";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { ProjectImageFiles } from "../../ports/project-image-files.js";

/** `<office-data>/project-images/<image id>`, each written whole or not at all. */
@Injectable()
export class FilesystemProjectImageFiles extends ProjectImageFiles {
  private readonly folder: string;

  constructor(officeData: OfficeDataDirectory) {
    super();
    this.folder = officeData.folder("project-images");
  }

  async save(imageId: string, content: Uint8Array): Promise<void> {
    await mkdir(this.folder, { recursive: true });
    const unfinished = `${this.pathOf(imageId)}.unfinished`;
    try {
      await writeFile(unfinished, content);
      await rename(unfinished, this.pathOf(imageId));
    } finally {
      await rm(unfinished, { force: true });
    }
  }

  async open(imageId: string): Promise<Readable> {
    const file = await open(this.pathOf(imageId));
    return file.createReadStream();
  }

  async remove(imageId: string): Promise<void> {
    await rm(this.pathOf(imageId), { force: true });
  }

  private pathOf(imageId: string): string {
    return join(this.folder, imageId);
  }
}
