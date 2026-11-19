/** A Task's open pull request, as Work reads it to resolve its conflicts. */
export interface TaskPullRequest {
  readonly projectId: string;
  readonly number: number;
  readonly url: string;
  /** The branch it merges. */
  readonly branch: string;
  /** The branch it merges into. */
  readonly baseBranch: string;
  /** Whether it merges cleanly, as last read: unknown until the code host has worked it out. */
  readonly mergeable: "yes" | "conflicts" | "unknown";
}

/**
 * The pull requests The Office opened, which the Projects module keeps. A port rather than that
 * module itself, as Projects is below Work: the composition root binds it.
 */
export abstract class TaskPullRequests {
  /** The Task's open pull request, as last read; undefined when it has none open. */
  abstract openOf(taskId: string): Promise<TaskPullRequest | undefined>;
}
