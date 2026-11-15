import type { FileOwnerIds } from "../domain/run-environment.js";

/**
 * The user and group The Office runs as, whom the files a check writes in a worktree are given
 * back to (spec §5.5 Defaults, "Run environments with a non-root Office"). None when The Office
 * runs as root or on Windows: then checks run exactly as they always have.
 */
export class ServiceOwner {
  constructor(readonly owner?: FileOwnerIds) {}
}

/** The owner a non-root Office hands files back to; root's files need no handing back. */
export function serviceOwnerOf(fileOwner: FileOwnerIds | undefined): ServiceOwner {
  return new ServiceOwner(fileOwner?.userId === 0 ? undefined : fileOwner);
}
