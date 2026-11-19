import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** Names as an observation records them: each once, sorted, so the order of events never shows. */
export function sortedNames(names: Iterable<string>): string[] {
  return [...new Set(names)].toSorted();
}

/** Every file under `folder`, by its path, none when it doesn't exist. */
export async function filesUnder(folder: string): Promise<Set<string>> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true }).catch(() => []);
  return new Set(
    entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name)),
  );
}

/** How many of `after`'s files `before` didn't have. */
export function newFiles(before: ReadonlySet<string>, after: ReadonlySet<string>): number {
  return [...after].filter((file) => !before.has(file)).length;
}

/** Whether a process still runs, by its id. */
export function processRunning(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}
