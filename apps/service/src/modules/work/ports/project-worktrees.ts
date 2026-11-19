/** A Task's worktree, as a session on the Task works in it. */
export interface TaskWorktree {
  readonly path: string;
  readonly branch: string;
  /** The Project's command environment. */
  readonly environment: Readonly<Record<string, string>>;
  /** Where an Agent writes its screenshots, relative to the worktree with "/" between folders. */
  readonly screenshotsFolder: string;
}

/** Where a Task's branch is checked out, if anywhere. */
export interface TaskBranchCheckout {
  /** The branch the Task's worktree holds. */
  readonly branch: string;
  /** The folder of the worktree that has it checked out, the user's own checkout among them. */
  readonly checkedOutIn: string | undefined;
  /** Whether that folder is the Task's own worktree. */
  readonly inTasksOwnWorktree: boolean;
}

/** The Tasks' worktrees, which the Projects module keeps; the composition root binds it. */
export abstract class ProjectWorktrees {
  /**
   * The Task's worktree, made the first time on a branch of its own at the freshly fetched base
   * branch (spec §5.5).
   */
  abstract open(projectId: string, taskId: string): Promise<TaskWorktree>;

  /** Where the Task's worktree is, without running git. */
  abstract find(projectId: string, taskId: string): Promise<TaskWorktree>;

  /** Whether the Task has a worktree in the Project: its folder is there. Runs no git. */
  abstract exists(projectId: string, taskId: string): Promise<boolean>;

  /** Which branch the Task's worktree holds, and where that branch is checked out, if anywhere. */
  abstract checkoutOfBranch(projectId: string, taskId: string): Promise<TaskBranchCheckout>;

  /** A few lines of what the Task's commits changed; undefined while they change nothing. */
  abstract changesSoFar(projectId: string, taskId: string): Promise<string | undefined>;
}
