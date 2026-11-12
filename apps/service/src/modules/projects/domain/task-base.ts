import type { RemoteBranch } from "./publication.js";

/**
 * What a Task's branch starts from and publishes into (spec §5.5, "A worktree per Task"): the
 * Project's base branch, or, for a Task of an Initiative with a Pipeline, its Initiative's branch
 * in the Project, which takes in the base branch in its turn.
 */
export type TaskBase =
  | { readonly kind: "base-branch" }
  | { readonly kind: "initiative-branch"; readonly branch: string };

/** An Initiative's branch as it stands once fetched: the newer of its local and remote commits. */
export interface FreshInitiativeBranch {
  readonly branch: string;
  /** The commit the Task's branch takes in. */
  readonly commit: string;
  /** The local branch's commit, which Publish moves the branch from. */
  readonly local: string;
  /** Where it is pushed: the base branch's remote, undefined when the base branch tracks none. */
  readonly remote: RemoteBranch | undefined;
}

/** A branch a Task's branch takes in, freshly fetched: its Initiative's branch, then the base. */
export interface FreshBase {
  readonly commit: string;
  /** What a merge of it and the words about it name. */
  readonly name: RemoteBranch;
}

/** An Initiative's branch the Task can't start from or publish into, with why, in the UI's words. */
export class InitiativeBranchUnusable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InitiativeBranchUnusable";
  }
}

export function initiativeBranchGone(
  branch: string,
  projectName: string,
): InitiativeBranchUnusable {
  return new InitiativeBranchUnusable(
    `The Initiative's branch ${branch} is gone from ${projectName}.`,
  );
}

export function initiativeBranchDiverged(
  branch: string,
  remote: string,
  projectName: string,
): InitiativeBranchUnusable {
  return new InitiativeBranchUnusable(
    `The Initiative's branch ${branch} in ${projectName} has diverged from ${branch} on ${remote}: each has commits the other doesn't. Bring them together by hand, then try again.`,
  );
}
