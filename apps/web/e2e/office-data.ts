import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The end-to-end service's Office data directory, emptied as it starts, so the environment checks'
 * worktrees stay out of the user's; a test finds a Task's worktree under it (spec §5.5).
 */
export const E2E_OFFICE_DATA = path.join(tmpdir(), "office-e2e-data");

/** Where the Office keeps a Task's worktree: `<office-data>/worktrees/<project>/<task>`. */
export function taskWorktreePath(projectId: string, taskId: string): string {
  return path.join(E2E_OFFICE_DATA, "worktrees", projectId, taskId);
}
