/** What making the Initiative's branch in a Project came to: its commit, or why it couldn't. */
export type InitiativeBranchMaking =
  | { readonly kind: "made"; readonly commit: string }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * The Initiative's branches in the Projects' repositories (spec 5.5), which the Projects module
 * makes; the composition root binds it. It never pushes, and none of it runs inside a database
 * hold.
 */
export abstract class ProjectInitiativeBranches {
  /**
   * Makes `branch` at the freshly fetched base branch, refused, with the Project named and why,
   * when it exists there already, locally or on the remote, or the base can't be fetched.
   */
  abstract make(projectId: string, branch: string): Promise<InitiativeBranchMaking>;

  /** Removes a branch the same attempt made, only while it is still at `commit`. */
  abstract remove(projectId: string, branch: string, commit: string): Promise<void>;

  /** Whether the Project's repository has `branch`. */
  abstract exists(projectId: string, branch: string): Promise<boolean>;

  /**
   * Whether `branch` holds commits not yet published: commits the Publishing Task
   * `publishedByTaskId` didn't publish, or, with none given, commits the freshly fetched base
   * branch doesn't have. True when unsure (the branch is gone, or git failed), so no work is left
   * unpublished unseen.
   */
  abstract holdsUnpublished(
    projectId: string,
    branch: string,
    publishedByTaskId?: string,
  ): Promise<boolean>;
}
