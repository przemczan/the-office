/** How a pull request's commits land on its base: a merge commit, squashed into one, or rebased. */
export const MERGE_METHODS = ["merge", "squash", "rebase"] as const;
export type MergeMethod = (typeof MERGE_METHODS)[number];

/** The merge method the Merge dialog picks first, and what it warns of. */
export interface RecommendedMergeMethod {
  /** Undefined only when the host allows no method at all. */
  readonly recommended: MergeMethod | undefined;
  /** Why the pick may not be what the user wants, in plain words; undefined when nothing is. */
  readonly warning: string | undefined;
}

const INITIATIVE_BRANCH = "initiative/";

/**
 * A merge commit for an Initiative's branch (`initiative/<short name>`), which keeps each of its
 * Tasks' commits; one squashed commit for anything else, a Task's branch among them. When the host
 * doesn't allow that, the first it allows. An Initiative's branch the host won't merge with a
 * merge commit is warned of, as squash and rebase rewrite its commits.
 */
export function recommendedMergeMethod(
  branch: string,
  allowed: readonly MergeMethod[],
): RecommendedMergeMethod {
  const ofInitiative = branch.startsWith(INITIATIVE_BRANCH);
  const preferred: MergeMethod = ofInitiative ? "merge" : "squash";
  const recommended = allowed.includes(preferred) ? preferred : allowed[0];
  const warning =
    ofInitiative && !allowed.includes("merge")
      ? "The repository doesn't allow merge commits, so squashing or rebasing rewrites the Initiative's commits: each Task's commit on the base branch is replaced by new ones."
      : undefined;
  return { recommended, warning };
}
