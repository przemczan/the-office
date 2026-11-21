import type { RemoteBranch } from "./publication.js";

/**
 * What a Task's branch starts from and publishes into (spec §5.5, "A worktree per Task"): the
 * Project's base branch, or, for a Task of an Initiative with a Pipeline, its Initiative's branch
 * in the Project, which takes in the base branch in its turn; or, for a Publishing Task, the
 * Initiative's branch itself, which its worktree holds and its Publish takes into the base branch
 * by the Project's publishing mode (spec §2.3, "A Publishing Task's Publish"); or, for a
 * Conflict resolution Task, the branch of the pull request of the Task `taskId`, which its
 * worktree holds, takes the base branch in by a merge, and pushes again (spec §2.3, "Resolve
 * conflicts").
 */
export type TaskBase =
  | { readonly kind: "base-branch" }
  | { readonly kind: "initiative-branch"; readonly branch: string }
  | { readonly kind: "publishing-task"; readonly branch: string }
  | { readonly kind: "pull-request"; readonly taskId: string };

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

/**
 * Whose branch a Task's worktree holds when it isn't a branch of the Task's own: an Initiative's
 * branch, held by its Publishing Task, or a pull request's, held by a Conflict resolution Task.
 */
export type ExistingBranchKind = "initiative" | "pull-request";

/** A branch the Task can't start from, hold or publish, with why, in the UI's words. */
export class ExistingBranchUnusable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExistingBranchUnusable";
  }
}

/** An Initiative's branch the Task can't start from or publish into, with why, in the UI's words. */
export class InitiativeBranchUnusable extends ExistingBranchUnusable {
  constructor(message: string) {
    super(message);
    this.name = "InitiativeBranchUnusable";
  }
}

/** A pull request's branch a Conflict resolution Task's worktree can't hold, with why. */
export class PullRequestBranchUnusable extends ExistingBranchUnusable {
  constructor(message: string) {
    super(message);
    this.name = "PullRequestBranchUnusable";
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

/** The Publishing Task's worktree can't check out its Initiative's branch, as another one has it. */
export function initiativeBranchCheckedOut(
  branch: string,
  worktreePath: string,
  projectName: string,
): InitiativeBranchUnusable {
  return new InitiativeBranchUnusable(
    `The Initiative's branch ${branch} of ${projectName} is checked out in ${worktreePath}, so the Publishing Task's worktree can't hold it. Check out another branch there, then try again.`,
  );
}

/** The pull request's branch is neither here nor on the remote, so nothing can resolve it. */
export function pullRequestBranchGone(
  branch: string,
  projectName: string,
): PullRequestBranchUnusable {
  return new PullRequestBranchUnusable(
    `The pull request's branch ${branch} is gone from ${projectName} and from its remote.`,
  );
}

export function pullRequestBranchDiverged(
  branch: string,
  remote: string,
  projectName: string,
): PullRequestBranchUnusable {
  return new PullRequestBranchUnusable(
    `The pull request's branch ${branch} in ${projectName} has diverged from ${branch} on ${remote}: each has commits the other doesn't. Bring them together by hand, then try again.`,
  );
}

/** The Conflict resolution Task's worktree can't check out the pull request's branch. */
export function pullRequestBranchCheckedOut(
  branch: string,
  worktreePath: string,
  projectName: string,
): PullRequestBranchUnusable {
  return new PullRequestBranchUnusable(
    `The branch ${branch} of ${projectName} is checked out in ${worktreePath}, so the Conflict resolution Task's worktree can't hold it. Check out another branch there, or remove that worktree, then try again.`,
  );
}

/** The branch picked for a test instance is neither here nor on the base branch's remote. */
export function testInstanceBranchNotFound(
  branch: string,
  projectName: string,
): ExistingBranchUnusable {
  return new ExistingBranchUnusable(
    `The branch ${branch} isn't in ${projectName} or on its remote.`,
  );
}

export function testInstanceBranchDiverged(
  branch: string,
  remote: string,
  projectName: string,
): ExistingBranchUnusable {
  return new ExistingBranchUnusable(
    `The branch ${branch} in ${projectName} has diverged from ${branch} on ${remote}: each has commits the other doesn't. Bring them together by hand, then try again.`,
  );
}

/** Why the branch of `kind` is unusable: gone, diverged from its remote's, or checked out elsewhere. */
export const existingBranchUnusable = {
  initiative: {
    gone: initiativeBranchGone,
    diverged: initiativeBranchDiverged,
    checkedOut: initiativeBranchCheckedOut,
  },
  "pull-request": {
    gone: pullRequestBranchGone,
    diverged: pullRequestBranchDiverged,
    checkedOut: pullRequestBranchCheckedOut,
  },
} as const satisfies Record<ExistingBranchKind, unknown>;
