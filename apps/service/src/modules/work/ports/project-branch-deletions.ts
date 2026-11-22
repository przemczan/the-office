/** One copy of a branch: the local branch, or the remote's, named `<remote>/<branch>`. */
export interface BranchCopy {
  readonly kind: "local" | "remote";
  readonly name: string;
  /** The commit judged; a deletion goes only while the copy is still at it. */
  readonly commit: string;
}

/** What a branch holds that its base lacks, lost once it is deleted. */
export interface BranchWork {
  readonly commitCount: number;
  /** The newest of their subjects, at most 5. */
  readonly subjects: readonly string[];
  /** For an Initiative's branch: its Tasks landed on it that no Publish took to the base. */
  readonly unpublishedTaskTitles: readonly string[];
}

/** What deleting a branch would delete, judged against the freshly fetched base. */
export interface BranchDeletionPreview {
  readonly branch: string;
  readonly baseBranch: string;
  readonly copies: readonly BranchCopy[];
  /** The Task's own worktree a deletion removes with it; null when none holds the branch. */
  readonly worktreePath: string | null;
  /** Null when everything on it is in the base. */
  readonly holdsWork: BranchWork | null;
  /** Why it can't be deleted at all; null when it can. */
  readonly refusal: string | null;
}

/** A deletion's request: the copies' commits as judged, and whether to delete work the base lacks. */
export interface BranchDeletionRequest {
  readonly expected: readonly Pick<BranchCopy, "kind" | "commit">[];
  readonly deleteUnmerged: boolean;
}

/**
 * Whose branch is judged, with what Work knows of it (spec 5.5, "Deleting merged branches"):
 * a Task's, merged into the base branch or into its Initiative's branch; or an Initiative's, with
 * the Publishing Task whose Publish took it to the base and the Tasks landed on it.
 */
export type BranchOwner =
  | {
      readonly kind: "task";
      readonly taskId: string;
      /** The Initiative's branch the Task publishes into; undefined for one publishing to the base. */
      readonly initiativeBranch?: string;
    }
  | {
      readonly kind: "initiative";
      /** Its Done Publishing Task in the Project, whose Publish may have taken the branch to the base. */
      readonly publishingTaskId?: string;
      /** Its Tasks in the Project, by id and title, named when their landed work is in no base. */
      readonly tasks: readonly { readonly taskId: string; readonly title: string }[];
    };

/** What deleting a branch came to: the copies that went, or why nothing did. */
export type BranchDeletion =
  | {
      readonly kind: "deleted";
      /** The copies deleted; one already gone on the host isn't among them. */
      readonly copies: readonly BranchCopy[];
      /** The Task's own worktree, removed with the branch; undefined when none held it. */
      readonly worktreePath?: string;
    }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * Deleting a Task's or an Initiative's branch in a Project, here and on the remote, which the
 * Projects module does under the repository's git lock; the composition root binds it. Never run
 * inside a database hold: it fetches and pushes.
 */
export abstract class ProjectBranchDeletions {
  /** Whether the Project's setting Delete branches once merged is On. */
  abstract deletesMergedBranches(projectId: string): Promise<boolean>;

  /** The Projects whose setting Delete branches once merged is On. */
  abstract projectsDeletingMergedBranches(): Promise<readonly string[]>;

  /**
   * The `office/*` and `initiative/*` branches the Project's repository knows, as local branches or
   * remote-tracking refs, each named once without its remote; nothing is fetched.
   */
  abstract knownBranches(projectId: string): Promise<readonly string[]>;

  /** Whether the repository knows `branch`, locally or as a remote-tracking ref; nothing is fetched. */
  abstract isKnown(projectId: string, branch: string): Promise<boolean>;

  /**
   * Judges `branch` against the freshly fetched base: its copies and the commits each is at, the
   * Task's own worktree holding it, what it holds the base lacks (null when nothing), and why it
   * can't be deleted at all (an open pull request, checked out in another worktree, the Task's
   * worktree with uncommitted changes, git failing), in plain words with the Project named.
   */
  abstract judge(
    projectId: string,
    branch: string,
    owner: BranchOwner,
  ): Promise<BranchDeletionPreview>;

  /**
   * Judges `branch` again, then deletes it: keeps a Task's tip, removes the Task's own worktree,
   * deletes the remote copy and then the local one, each only at the commit judged. Refused when
   * the judgement refuses, a copy isn't at `request.expected`'s commit ("The branch changed since
   * it was checked; check again."), or it holds work the base lacks and `deleteUnmerged` is false.
   */
  abstract delete(
    projectId: string,
    branch: string,
    owner: BranchOwner,
    request: BranchDeletionRequest,
  ): Promise<BranchDeletion>;
}
