import type { RemoteBranch } from "./publication.js";

/**
 * How Resolve's merge began (spec §2.3.1, "An Agent Stage may merge the base first"): the Task's
 * fetched bases merged into its branch in turn, with the first conflict's files left in the
 * worktree for the Agent; merged cleanly, as the bases moved on past the conflict; or a failure,
 * such as a fetch git refused.
 */
export type ResolveStart =
  | {
      readonly kind: "conflicted";
      /** The base whose merge conflicted: the Task's Initiative's branch or the base branch. */
      readonly base: RemoteBranch;
      readonly conflictedFiles: readonly string[];
      /** Where a clean merge of an earlier base left HEAD before the conflict. */
      readonly commit?: string;
    }
  | { readonly kind: "merged"; readonly base: RemoteBranch; readonly commit: string }
  | { readonly kind: "failed"; readonly error: string };

/**
 * How Resolve's merge ended: committed as one merge commit, or not, as files still hold conflict
 * markers, or a failure, such as no merge in progress to commit.
 */
export type ResolveEnd =
  | { readonly kind: "resolved"; readonly commit: string }
  | { readonly kind: "markers-left"; readonly files: readonly string[] }
  | { readonly kind: "failed"; readonly error: string };

/** The base a merge names: its upstream, or the local branch when it tracks none. */
export function mergedBase(baseBranch: string, upstream: RemoteBranch | undefined): RemoteBranch {
  return upstream ?? { remote: "this repository", branch: baseBranch };
}

/** The words of the merge commit that brings a base into the Task's branch. */
export function mergeMessage(base: RemoteBranch, branch: string): string {
  return `Merge ${base.branch} from ${base.remote} into ${branch}`;
}
