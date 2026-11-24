/**
 * A Project's files as committed, read from its repository's objects, and a folder of a Task's
 * worktree committed on its own; refusals come as `RunEnvironmentSettingRefused`.
 */
export abstract class RepositoryFiles {
  /** The base branch's last commit fetched, with no fetch now; undefined when there is none. */
  abstract lastFetchedBase(projectId: string): Promise<string | undefined>;

  /** The base branch's commit fetched now, or the last one known when the fetch fails. */
  abstract freshBase(projectId: string): Promise<string>;

  /**
   * Where the Task's branch points, or pointed when it was deleted; undefined when it has none.
   */
  abstract taskBranchTip(projectId: string, taskId: string): Promise<string | undefined>;

  /**
   * Where the Task's branch, at `tip`, forked from the base branch: as its last Publish recorded
   * it, else where `tip` and `base` last met. Its changes are what `tip` holds over it.
   */
  abstract taskForkPoint(
    projectId: string,
    taskId: string,
    tip: string,
    base: string,
  ): Promise<string>;

  /** The text of the file `path` names at `commit`; undefined when it names no file there. */
  abstract textAt(projectId: string, commit: string, path: string): Promise<string | undefined>;

  /**
   * The uncommitted paths under `folder` of the Task's worktree at `worktree`, relative to it:
   * staged, unstaged and untracked ones.
   */
  abstract uncommittedPathsUnder(worktree: string, folder: string): Promise<readonly string[]>;

  /**
   * Commits only `folder` of the Task's worktree at `worktree` to the Task's branch, everything
   * else in it left out and as it was; the branch's commit holding the folder.
   */
  abstract commitFolder(worktree: string, folder: string, message: string): Promise<string>;

  /**
   * Puts only `folder` of the Task's worktree at `worktree` back as committed, its untracked files
   * removed; everything else in it stays as it was.
   */
  abstract restoreFolder(worktree: string, folder: string): Promise<void>;
}
