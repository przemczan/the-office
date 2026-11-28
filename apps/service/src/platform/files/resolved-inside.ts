import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";

/** Where a path in a folder leads once its links are followed. */
export type ResolvedInside =
  | { readonly state: "inside"; readonly path: string }
  | { readonly state: "outside" }
  | { readonly state: "missing" };

/**
 * Follows every link on the way to `path`, a path in `folder`: inside, with its real path, when it
 * lies within the folder's own real path; outside when it lies elsewhere, or is a link to nothing,
 * which can't be inside either; missing when nothing is there, nor the folder. So a file of a worktree or checkout
 * that an Agent replaced with a link to one of this computer's files is never read as its own.
 */
export async function resolvedInside(folder: string, path: string): Promise<ResolvedInside> {
  const root = await realpath(folder).catch(() => undefined);
  if (root === undefined) return { state: "missing" };
  const real = await realpath(path).catch(() => undefined);
  if (real === undefined) {
    const isLink = await lstat(path).then(
      (stats) => stats.isSymbolicLink(),
      () => false,
    );
    return isLink ? { state: "outside" } : { state: "missing" };
  }
  return isInside(root, real) ? { state: "inside", path: real } : { state: "outside" };
}

function isInside(root: string, path: string): boolean {
  const fromRoot = relative(root, path);
  return (
    fromRoot !== "" &&
    fromRoot !== ".." &&
    !fromRoot.startsWith(`..${sep}`) &&
    !isAbsolute(fromRoot)
  );
}
