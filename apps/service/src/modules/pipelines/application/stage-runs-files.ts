import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Injectable } from "@nestjs/common";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import type { StageRunsFile } from "../domain/stage-runs-file.js";

const FILE_NAME = "stage-runs.json";

/**
 * Each Task's file of its earlier Stage runs, which a condition command reads (spec §2.3, "The
 * Project-command condition"), in the Task's own folder under the Office data directory. The run
 * environment mounts the folder, never the file: a file's bind mount keeps the inode it found, so
 * the file is replaced by a rename within the folder and the command reads the new one.
 */
@Injectable()
export class StageRunsFiles {
  constructor(private readonly officeData: OfficeDataDirectory) {}

  /** Writes the Task's file, replacing the one written before; returns its path. */
  async write(taskId: string, file: StageRunsFile): Promise<string> {
    const folder = this.officeData.stageRunsFolder(taskId);
    await mkdir(folder, { recursive: true });
    const path = join(folder, FILE_NAME);
    const written = join(folder, `.${FILE_NAME}.${randomUUID()}`);
    await writeFile(written, `${JSON.stringify(file, null, 2)}\n`);
    await rename(written, path);
    return path;
  }

  /** Removes the Task's folder, with the Task's worktree; nothing when there is none. */
  async remove(taskId: string): Promise<void> {
    await rm(this.officeData.stageRunsFolder(taskId), { recursive: true, force: true });
  }
}
