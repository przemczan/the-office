import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Injectable } from "@nestjs/common";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import { currentOperatingSystem } from "../../../platform/os/current-operating-system.js";

/** The Office data directory's `identity` folder, readable by its owner only, as what it holds. */
@Injectable()
export class IdentityFolder {
  private readonly path: string;
  private prepared: Promise<void> | undefined;

  constructor(officeData: OfficeDataDirectory) {
    this.path = officeData.folder("identity");
  }

  /** Where a file of the folder is. */
  file(name: string): string {
    return join(this.path, name);
  }

  /** Makes the folder, owner-only, once per process; the files then made in it start owner-only. */
  prepare(): Promise<void> {
    this.prepared ??= this.restrict().catch((error: unknown) => {
      this.prepared = undefined;
      throw error;
    });
    return this.prepared;
  }

  /**
   * A file holding `content`, named `<prefix>-<digest><extension>` by what it holds, written when
   * missing; so versions of The Office or commands with different content never share one.
   */
  async fileHolding(prefix: string, extension: string, content: string): Promise<string> {
    await this.prepare();
    const digest = createHash("sha256").update(content).digest("hex").slice(0, 16);
    const file = this.file(`${prefix}-${digest}${extension}`);
    if (existsSync(file)) return file;
    // Written beside and renamed, so a command in another process never reads it half written.
    const partial = `${file}.${randomUUID()}`;
    await writeFile(partial, content);
    try {
      await rename(partial, file);
    } catch (error) {
      await rm(partial, { force: true });
      if (!existsSync(file)) throw error;
    }
    return file;
  }

  private async restrict(): Promise<void> {
    await mkdir(this.path, { recursive: true, mode: 0o700 });
    await currentOperatingSystem().restrictToOwner(this.path, "folder");
  }
}
