import { rm } from "node:fs/promises";
import { join } from "node:path";
import { Injectable } from "@nestjs/common";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { skillNameProblems } from "../../domain/skill.js";
import { skillFilesHash, sortedByPath, type SkillFile } from "../../domain/skill-files.js";
import { SkillVersionMissing } from "../../domain/skill-version-missing.js";
import { LibraryFolder } from "../../ports/library-folder.js";
import {
  exists,
  namesIn,
  readSkillFiles,
  UNFINISHED,
  writeSkillFiles,
  writeWhole,
} from "./skill-file-folders.js";

const FILES_HASH = /^[0-9a-f]{64}$/;

/** `<office-data>/skills/<skill name>/<files hash>/`, each written whole or not at all. */
@Injectable()
export class FilesystemLibraryFolder extends LibraryFolder {
  private readonly path: string;

  constructor(officeData: OfficeDataDirectory) {
    super();
    this.path = officeData.folder("skills");
  }

  async keep(skillName: string, files: readonly SkillFile[]): Promise<string> {
    const filesHash = skillFilesHash(files);
    await writeWhole(
      this.versionFolder(skillName, filesHash),
      (writing) => writeSkillFiles(writing, files),
      { replace: false },
    );
    return filesHash;
  }

  async read(skillName: string, filesHash: string): Promise<readonly SkillFile[]> {
    const folder = this.versionFolder(skillName, filesHash);
    const missing = (reason: string) => new SkillVersionMissing(skillName, filesHash, reason);
    if (!(await exists(folder))) throw missing("they were never kept, or were removed.");
    const files = await readSkillFiles(folder, (path) =>
      missing(`"${path}" is not a regular file.`),
    );
    if (skillFilesHash(files) !== filesHash) throw missing("its files have changed since.");
    return sortedByPath(files);
  }

  async prune(keep: (skillName: string, filesHash: string) => boolean): Promise<void> {
    for (const skillName of await namesIn(this.path)) {
      const skillFolder = join(this.path, skillName);
      const versions = await namesIn(skillFolder);
      const discarded = versions.filter(
        (version) => UNFINISHED.test(version) || !keep(skillName, version),
      );
      for (const version of discarded) {
        await rm(join(skillFolder, version), { recursive: true, force: true });
      }
      if (discarded.length === versions.length) {
        await rm(skillFolder, { recursive: true, force: true });
      }
    }
  }

  private versionFolder(skillName: string, filesHash: string): string {
    // Both name folders, so neither may lead out of the library.
    if (skillNameProblems(skillName).length > 0) {
      throw new Error(`"${skillName}" can't name a skill's folder.`);
    }
    if (!FILES_HASH.test(filesHash)) throw new Error(`"${filesHash}" is no files hash.`);
    return join(this.path, skillName, filesHash);
  }
}
