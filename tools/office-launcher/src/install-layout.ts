import { existsSync, lstatSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { CURRENT_LINK, RELEASE_STAMP_FILE, RELEASES_FOLDER } from "./release-update.ts";

/**
 * How The Office the launcher runs from was installed: a git checkout, a release in a direct
 * install's `releases/` folder with its `current` link, or neither, which can't update itself.
 */
export type InstallLayout =
  | { readonly mode: "checkout"; readonly repository: string }
  | { readonly mode: "release"; readonly release: string; readonly installRoot: string }
  | { readonly mode: "not-installed"; readonly root: string };

/** The layout around `root`, the real path of the launcher's own copy of The Office. */
export function installLayoutOf(root: string): InstallLayout {
  if (existsSync(join(root, ".git"))) return { mode: "checkout", repository: root };
  const installRoot = dirname(dirname(root));
  if (
    existsSync(join(root, RELEASE_STAMP_FILE)) &&
    basename(dirname(root)) === RELEASES_FOLDER &&
    isSymbolicLink(join(installRoot, CURRENT_LINK))
  ) {
    return { mode: "release", release: root, installRoot };
  }
  return { mode: "not-installed", root };
}

function isSymbolicLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
