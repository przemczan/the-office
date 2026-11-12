/** What a conflict with the base does: the branch given back, or left for an Agent to resolve. */
export type ConflictHandling = "give-back" | "leave";

/** How bringing a Task's branch to its fresh bases went (spec §2.3). */
export type BranchUpdate =
  | { readonly kind: "up-to-date" }
  | { readonly kind: "updated"; readonly commit: string }
  | {
      readonly kind: "conflicted";
      readonly conflictedFiles: readonly string[];
      /** The branch whose merge conflicted; undefined for a merge left in the worktree earlier. */
      readonly from?: string;
      /** Where a clean merge or fast-forward of an earlier base left HEAD before the conflict. */
      readonly commit?: string;
    }
  | { readonly kind: "failed"; readonly error: string };
