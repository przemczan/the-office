import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { officeUpdateResultSchema } from "@the-office/contracts";
import type { OfficeUpdateResult } from "../../domain/office-update-result.js";
import { UpdateFolder } from "../../ports/update-folder.js";

// The files the launcher reads and writes (tools/office-launcher/src/office-update.ts).
const REQUEST_FILE = "request.json";
const RESULT_FILE = "result.json";
const LOG_FILE = "log.txt";
/** A result once the service has announced it, so a restart doesn't announce it again. */
const LAST_RESULT_FILE = "last-result.json";

/** The launcher's folder, as `OFFICE_UPDATE_FOLDER` names it; none without the launcher. */
export class FilesystemUpdateFolder extends UpdateFolder {
  constructor(private readonly folder: string | undefined) {
    super();
  }

  get launched(): boolean {
    return this.folder !== undefined;
  }

  async writeRequest(target: string): Promise<void> {
    await mkdir(this.path(""), { recursive: true });
    await writeFile(this.path(REQUEST_FILE), `${JSON.stringify({ target })}\n`);
  }

  async takeNewResult(): Promise<OfficeUpdateResult | undefined> {
    if (!this.folder) return undefined;
    const result = await this.readResult(RESULT_FILE);
    if (result) await rename(this.path(RESULT_FILE), this.path(LAST_RESULT_FILE));
    return result;
  }

  async lastResult(): Promise<OfficeUpdateResult | undefined> {
    return this.folder ? this.readResult(LAST_RESULT_FILE) : undefined;
  }

  async log(): Promise<string | undefined> {
    return this.folder ? readIfThere(this.path(LOG_FILE)) : undefined;
  }

  private async readResult(file: string): Promise<OfficeUpdateResult | undefined> {
    const text = await readIfThere(this.path(file));
    if (text === undefined) return undefined;
    const result = officeUpdateResultSchema.parse(JSON.parse(text));
    return { ...result, finishedAt: new Date(result.finishedAt) };
  }

  private path(file: string): string {
    if (!this.folder) throw new Error("The Office runs without its launcher, which has no folder.");
    return join(this.folder, file);
  }
}

async function readIfThere(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
