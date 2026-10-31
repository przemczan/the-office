import { glob, stat } from "node:fs/promises";
import { basename } from "node:path";
import type { ToolContext } from "./built-in-tool.js";

/** Folders a search never walks into: Git's own, and installed packages. */
const SKIPPED_FOLDERS: ReadonlySet<string> = new Set([".git", "node_modules"]);

export interface ListedFile {
  /** Absolute, as the session's path rules resolve it. */
  readonly path: string;
  readonly modifiedMs: number;
}

/**
 * The files under `root` that `pattern` matches and the session may read, the most recently
 * changed first, as Claude Code lists them.
 */
export async function listedFiles(
  root: string,
  pattern: string,
  context: ToolContext,
): Promise<ListedFile[]> {
  const files: ListedFile[] = [];
  const matches = glob(pattern, {
    cwd: root,
    exclude: (name) => SKIPPED_FOLDERS.has(basename(name)),
  });
  for await (const match of matches) {
    const path = context.paths.resolve(root, match);
    if (!context.mayRead(path)) continue;
    const file = await statOrUndefined(path);
    if (file?.isFile()) files.push({ path, modifiedMs: file.mtimeMs });
  }
  return files.toSorted(
    (first, second) =>
      second.modifiedMs - first.modifiedMs || first.path.localeCompare(second.path),
  );
}

async function statOrUndefined(path: string) {
  try {
    return await stat(path);
  } catch {
    // Gone since the listing found it, or a broken link.
    return undefined;
  }
}
