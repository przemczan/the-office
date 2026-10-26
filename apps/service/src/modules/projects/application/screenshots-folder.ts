import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** The Office's own folder in a Task's worktree, which ignores itself so git never sees it. */
const OFFICE_FOLDER = ".office";
const IGNORE_EVERYTHING = "*\n";

/**
 * Where an Agent writes the screenshots it lists in its Stage's result (research §8), relative to
 * the worktree with "/" between folders. git ignores it, so no commit holds them.
 */
export const SCREENSHOTS_FOLDER = `${OFFICE_FOLDER}/screenshots`;

/**
 * Makes the screenshots folder, ignored by git through a `.gitignore` of its own rather than the
 * repository's `info/exclude`, which every worktree of the user's repository shares.
 */
export async function ensureScreenshotsFolder(worktreePath: string): Promise<void> {
  await mkdir(join(worktreePath, SCREENSHOTS_FOLDER), { recursive: true });
  const ignore = join(worktreePath, OFFICE_FOLDER, ".gitignore");
  if ((await readFile(ignore, "utf8").catch(() => undefined)) !== IGNORE_EVERYTHING) {
    await writeFile(ignore, IGNORE_EVERYTHING);
  }
}

/**
 * Runs `work`, then puts the worktree's screenshots folder back as it was before, so what a test
 * run wrote, overwrote or deleted there never reaches what the Agent lists (research §8). The copy
 * is made in full before `work` starts, so a copy that fails loses nothing.
 */
export async function keepingScreenshots<T>(
  worktreePath: string,
  copyFolder: string,
  work: () => Promise<T>,
): Promise<T> {
  const folder = join(worktreePath, SCREENSHOTS_FOLDER);
  const kept = await exists(folder);
  if (kept) {
    await rm(copyFolder, { recursive: true, force: true });
    await cp(folder, copyFolder, { recursive: true });
  }
  try {
    return await work();
  } finally {
    await rm(folder, { recursive: true, force: true });
    if (kept) {
      await mkdir(dirname(folder), { recursive: true });
      // The copy is under the Office data directory, as the worktree is, so it never crosses volumes.
      await rename(copyFolder, folder);
    }
  }
}

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined)) !== undefined;
}
