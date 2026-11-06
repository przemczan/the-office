import type { BranchUpdate, ConflictHandling } from "../domain/stage-commit.js";

/** The commit and branch a Task's worktree has checked out. */
export interface WorktreeHead {
  readonly commit: string;
  /** Undefined when HEAD is detached. */
  readonly branch: string | undefined;
}

/**
 * The git changes The Office makes in the started Tasks' worktrees, which Projects keeps; the
 * composition root binds it. Agents never commit: The Office does, after each Stage (spec §5.5).
 */
export abstract class TaskGit {
  abstract head(projectId: string, taskId: string): Promise<WorktreeHead>;

  /**
   * Commits every change in the Task's worktree to its branch. Returns the new commit, or
   * undefined when nothing changed.
   */
  abstract commit(projectId: string, taskId: string, message: string): Promise<string | undefined>;

  /**
   * Drops every uncommitted change in the Task's worktree, untracked files included and ignored
   * ones, such as dependencies, kept. Returns the dropped paths.
   */
  abstract discard(projectId: string, taskId: string): Promise<readonly string[]>;

  /** Brings the Task's branch to the freshly fetched base, by a fast-forward or a merge. */
  abstract updateFromBase(
    projectId: string,
    taskId: string,
    onConflict: ConflictHandling,
  ): Promise<BranchUpdate>;

  /**
   * Whether the worktree's HEAD descends from `from` and is in the freshly fetched base's history,
   * with nothing uncommitted: a move along the base, which loses nothing (spec §2.3).
   */
  abstract movedAlongBase(projectId: string, taskId: string, from: string): Promise<boolean>;

  /** A few lines of what the Task's commits changed so far; undefined while nothing. */
  abstract changesSoFar(projectId: string, taskId: string): Promise<string | undefined>;

  /**
   * Removes the Task's worktree with whatever it holds, as after Publish; its branch stays, and a
   * later Stage gets the worktree back from it.
   */
  abstract removeWorktree(projectId: string, taskId: string): Promise<void>;
}
