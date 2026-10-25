import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Injectable } from "@nestjs/common";
import { OfficeDataDirectory } from "../../../../platform/office-data/office-data-directory.js";
import { skillNameProblems } from "../../domain/skill.js";
import {
  skillFilePathProblem,
  skillFilesHash,
  sortedByPath,
  type SkillFile,
} from "../../domain/skill-files.js";
import { SkillVersionMissing } from "../../domain/skill-version-missing.js";
import { LibraryFolder } from "../../ports/library-folder.js";

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
    const folder = this.versionFolder(skillName, filesHash);
    if (await exists(folder)) return filesHash;
    // Written beside the version and renamed into place, so a version's folder is always whole.
    const writing = join(dirname(folder), `.writing-${randomUUID()}`);
    try {
      await mkdir(writing, { recursive: true });
      for (const file of files) {
        const path = inside(writing, file.path);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, file.content, { flag: "wx" });
      }
      await rename(writing, folder).catch(async (error: unknown) => {
        // Another call kept the same files first.
        if (!(await exists(folder))) throw error;
      });
    } finally {
      await rm(writing, { recursive: true, force: true });
    }
    return filesHash;
  }

  async read(skillName: string, filesHash: string): Promise<readonly SkillFile[]> {
    const folder = this.versionFolder(skillName, filesHash);
    const missing = (reason: string) => new SkillVersionMissing(skillName, filesHash, reason);
    if (!(await exists(folder))) throw missing("they were never kept, or were removed.");
    const files = await filesIn(folder, "", missing);
    if (skillFilesHash(files) !== filesHash) throw missing("its files have changed since.");
    return sortedByPath(files);
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

function inside(folder: string, path: string): string {
  const problem = skillFilePathProblem(path);
  if (problem) throw new Error(problem);
  return join(folder, ...path.split("/"));
}

/** Every regular file below `folder`, refusing links (junctions too, on Windows). */
async function filesIn(
  folder: string,
  prefix: string,
  missing: (reason: string) => Error,
): Promise<SkillFile[]> {
  const files: SkillFile[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    const absolute = join(folder, entry.name);
    if (entry.isDirectory()) files.push(...(await filesIn(absolute, path, missing)));
    else if (entry.isFile())
      files.push({ path, content: new Uint8Array(await readFile(absolute)) });
    else throw missing(`"${path}" is not a regular file.`);
  }
  return files;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
