/**
 * Deleting a Task's or an Initiative's branch (spec §5.5, "Deleting merged branches"): what is
 * judged and what a deletion came to.
 */

/**
 * Whose branch is judged, with what Work knows of it: a Task's, merged into the base branch or
 * into its Initiative's branch; or an Initiative's, with the Publishing Task whose Publish may have
 * taken it to the base and the Tasks landed on it.
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
  /** The newest of their subjects, at most `BRANCH_WORK_SUBJECTS`. */
  readonly subjects: readonly string[];
  /** For an Initiative's branch: its Tasks landed on it that no Publish took to the base. */
  readonly unpublishedTaskTitles: readonly string[];
}

/** What deleting a branch would delete, judged against the freshly fetched base. */
export interface BranchDeletionPreview {
  readonly branch: string;
  /** What it was judged against: the base branch, or a Task's Initiative's branch. */
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

/** How many commit subjects a branch holding work names. */
export const BRANCH_WORK_SUBJECTS = 5;

/** The two kinds of branch The Office deletes: `office/<task id>` and `initiative/<short name>`. */
export const DELETABLE_BRANCH_PREFIXES = ["office/", "initiative/"] as const;

/** Whether two sets of copies are at the same commits, kind by kind. */
export function sameCopies(
  judged: readonly Pick<BranchCopy, "kind" | "commit">[],
  expected: readonly Pick<BranchCopy, "kind" | "commit">[],
): boolean {
  const key = ({ kind, commit }: Pick<BranchCopy, "kind" | "commit">): string =>
    `${kind}:${commit}`;
  const judgedKeys = judged.map(key).toSorted();
  const expectedKeys = expected.map(key).toSorted();
  return (
    judgedKeys.length === expectedKeys.length &&
    judgedKeys.every((judgedKey, index) => judgedKey === expectedKeys[index])
  );
}
