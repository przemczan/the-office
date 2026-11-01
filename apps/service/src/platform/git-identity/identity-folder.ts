import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Injectable } from "@nestjs/common";
import { OfficeDataDirectory } from "../office-data/office-data-directory.js";
import { currentOperatingSystem } from "../os/current-operating-system.js";

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

  private async restrict(): Promise<void> {
    await mkdir(this.path, { recursive: true, mode: 0o700 });
    await currentOperatingSystem().restrictToOwner(this.path, "folder");
  }
}
