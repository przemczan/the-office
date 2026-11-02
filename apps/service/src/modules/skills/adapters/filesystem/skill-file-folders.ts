import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { moveWhenFree } from "../../../../platform/os/move-when-free.js";
import { skillFilePathProblem, type SkillFile } from "../../domain/skill-files.js";

/** What a write left when it was interrupted: never a whole folder, so always safe to remove. */
export const UNFINISHED = /^\.writing-/;

/**
 * Writes a folder whole or not at all: beside `folder`, then renamed into its place. Returns
 * false, writing nothing, when `folder` exists and `replace` is false.
 */
export async function writeWhole(
  folder: string,
  write: (writing: string) => Promise<void>,
  { replace }: { readonly replace: boolean },
): Promise<boolean> {
  if (!replace && (await exists(folder))) return false;
  const writing = join(dirname(folder), `.writing-${randomUUID()}`);
  try {
    await mkdir(writing, { recursive: true });
    await write(writing);
    if (replace) await rm(folder, { recursive: true, force: true });
    try {
      await rename(writing, folder);
    } catch {
      // Another call wrote the same folder first; otherwise the folder may only be busy.
      if (replace || !(await exists(folder))) await moveWhenFree(writing, folder);
    }
  } finally {
    await rm(writing, { recursive: true, force: true });
  }
  return true;
}

/** Writes each file below `folder` as a new regular file, never outside it. */
export async function writeSkillFiles(folder: string, files: readonly SkillFile[]): Promise<void> {
  for (const file of files) {
    const problem = skillFilePathProblem(file.path);
    if (problem) throw new Error(problem);
    const path = join(folder, ...file.path.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.content, { flag: "wx" });
  }
}

/**
 * Every regular file below `folder`, with its path from there; `refuse` makes the error for
 * anything else, a link or a junction among them.
 */
export async function readSkillFiles(
  folder: string,
  refuse: (path: string) => Error,
  prefix = "",
): Promise<SkillFile[]> {
  const files: SkillFile[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    const absolute = join(folder, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await readSkillFiles(absolute, refuse, path)));
    } else if (entry.isFile()) {
      files.push({ path, content: new Uint8Array(await readFile(absolute)) });
    } else {
      throw refuse(path);
    }
  }
  return files;
}

/** The names in `folder`, or none when there is no such folder. */
export async function namesIn(folder: string): Promise<string[]> {
  try {
    return await readdir(folder);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
