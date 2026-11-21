import type { FileOwnerIds } from "../domain/run-environment.js";

/**
 * The user and group The Office runs as, whom the files a check writes in a worktree are given
 * back to (spec §5.5 Defaults, "Run environments with a non-root Office"). None when The Office
 * runs as root or on Windows: then checks run exactly as they always have.
 */
export class ServiceOwner {
  constructor(
    readonly owner?: FileOwnerIds,
    /**
     * Whether the files The Office makes carry a numeric owner a container's user is checked
     * against: not on Windows, where a mounted folder's files are everyone's and `chown` on them
     * fails.
     */
    readonly filesHaveOwners = true,
  ) {}
}

/** The owner a non-root Office hands files back to; root's files need no handing back. */
export function serviceOwnerOf(fileOwner: FileOwnerIds | undefined): ServiceOwner {
  if (fileOwner === undefined) return new ServiceOwner(undefined, false);
  return new ServiceOwner(fileOwner.userId === 0 ? undefined : fileOwner);
}
