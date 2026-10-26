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

  /** A few lines of what the Task's commits changed so far; undefined while nothing. */
  abstract changesSoFar(projectId: string, taskId: string): Promise<string | undefined>;
}
