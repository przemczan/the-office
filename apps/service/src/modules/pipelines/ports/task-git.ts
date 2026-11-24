import type {
  BranchUpdate,
  ConflictHandling,
  PublishingBranchPush,
} from "../domain/stage-commit.js";

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
   * The paths one of the Task's commits changed against its first parent: added, changed and
   * deleted ones, and both paths of a rename. For a merge commit, only the paths its own
   * resolution changed against every parent.
   */
  abstract committedPaths(
    projectId: string,
    taskId: string,
    commit: string,
  ): Promise<readonly string[]>;

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

  /** Whether the Task's worktree holds a merge of the base left for an Agent to resolve. */
  abstract mergeInProgress(projectId: string, taskId: string): Promise<boolean>;

  /**
   * Whether the worktree's HEAD descends from `from` and is in the freshly fetched base's history,
   * with nothing uncommitted: a move along the base, which loses nothing (spec §2.3).
   */
  abstract movedAlongBase(projectId: string, taskId: string, from: string): Promise<boolean>;

  /**
   * Pushes a Publishing Task's branch, the Initiative's, without force to the base branch's
   * remote after its Stage's commit (spec 5.5, "The Initiative's branch"); `not-needed` for any
   * other Task, or when the base branch tracks no remote.
   */
  abstract pushPublishingBranch(projectId: string, taskId: string): Promise<PublishingBranchPush>;

  /** A few lines of what the Task's commits changed so far; undefined while nothing. */
  abstract changesSoFar(projectId: string, taskId: string): Promise<string | undefined>;

  /**
   * The revisions `changesSoFar` counts the Task's changes from, as git names them here: the base
   * branch as its upstream has it, after the Initiative's branch for a Task of one.
   */
  abstract changeBases(projectId: string, taskId: string): Promise<readonly string[]>;

  /**
   * Resets the Task's branch for a Start over (spec §2.4.5): fetches its base fresh (its
   * Initiative's branch for a Task of one, else the Project's base branch, as `updateFromBase`
   * takes them in), keeps the branch's head now under the local ref `keptRef`, then hard-resets
   * the branch to the fetched base: in its worktree, uncommitted changes dropped and ignored files
   * kept, when it has one, else by moving the branch in the Project's repository. Answers the base
   * branch it was reset to, by name, and the commit the branch is at now.
   */
  abstract resetBranchToBase(
    projectId: string,
    taskId: string,
    keptRef: string,
  ): Promise<{ readonly resetTo: string; readonly commit: string }>;

  /**
   * Removes the Task's worktree with whatever it holds, as after Publish; its branch stays, and a
   * later Stage gets the worktree back from it.
   */
  abstract removeWorktree(projectId: string, taskId: string): Promise<void>;
}
