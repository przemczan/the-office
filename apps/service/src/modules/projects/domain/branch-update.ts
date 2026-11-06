/** What a conflict with the base does: the branch given back, or left for an Agent to resolve. */
export type ConflictHandling = "give-back" | "leave";

/** How bringing a Task's branch to the fresh base went (spec §2.3). */
export type BranchUpdate =
  | { readonly kind: "up-to-date" }
  | { readonly kind: "updated"; readonly commit: string }
  | { readonly kind: "conflicted"; readonly conflictedFiles: readonly string[] }
  | { readonly kind: "failed"; readonly error: string };
