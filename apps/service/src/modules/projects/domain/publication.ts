/**
 * The Task's commit message (spec §2.3, "The Task's commit message"): the message of the one commit
 * Publish lands the Task as, whole, and its subject line and the rest, a pull request's title and
 * body.
 */
export interface CommitMessage {
  readonly subject: string;
  readonly body: string;
  readonly whole: string;
}

/**
 * Where a Publish Stage takes the Task's branch (spec §2.3): by the Project's publishing mode, or
 * pushed as a branch only, with no pull request and no merge.
 */
export type PublishTarget = "publishing-mode" | "branch-only";

/** A branch on a remote. */
export interface RemoteBranch {
  readonly remote: string;
  readonly branch: string;
}

/** Whether Publish took in a base that had moved on since the branch left it, by a merge commit. */
export type BaseTakenIn = "not-needed" | "by-merge";

/**
 * How a Publish ended, by the Project's publishing mode (spec §9) or the Stage's target (spec §2.3):
 * the Task's branch pushed with a pull request open, merged into the base branch on its remote, or
 * pushed as a branch only; nothing to publish; the base
 * moved on so the branch would conflict with it, which Resolve takes; or a failure,
 * such as a refused push, in words for the Agent who repairs it or the user.
 */
export type Publication =
  | { readonly kind: "pull-request-opened"; readonly branch: string; readonly url: string }
  | {
      readonly kind: "merged";
      readonly branch: string;
      readonly into: RemoteBranch;
      /**
       * Where `into` is now: the one commit that landed the Task with its commit message, or a
       * Publishing Task's tip, whose commits it carried unchanged.
       */
      readonly commit: string;
      /** The landed commit's subject, when Publish landed the Task as one commit. */
      readonly subject?: string;
      /** Where the Task's branch is left: its tip, with any base taken in by a merge commit. */
      readonly head: string;
      /** Whether The Office took a base that had moved on into the Task's branch by a merge. */
      readonly baseTakenIn: BaseTakenIn;
      /** For a Task of an Initiative's branch, the bases that had moved on, in the order taken in. */
      readonly basesTakenIn?: readonly string[];
      /**
       * The Publishing Task whose worktree held the Initiative's branch and was fast-forwarded to
       * `commit`, for its next Stage's Agent to be told (spec §2.3, "A Publishing Task's Publish").
       */
      readonly movedWorktreeOf?: string;
    }
  | { readonly kind: "branch-pushed"; readonly branch: string; readonly remote: string }
  | { readonly kind: "nothing-to-publish"; readonly branch: string; readonly base: RemoteBranch }
  | {
      readonly kind: "base-moved";
      readonly error: string;
      /** The files it would conflict in. */
      readonly conflictedFiles: readonly string[];
      /** Where a clean take-in of an earlier base, the Initiative's branch, left the branch. */
      readonly commit?: string;
    }
  | { readonly kind: "failed"; readonly error: string };

/**
 * How pushing a Publishing Task's Initiative's branch after a Stage went (spec §5.5, "Pushed"): not
 * needed, as the Task is no Publishing Task or the base branch tracks no remote; pushed; or refused,
 * with why in words for the Stage's outcome, which it doesn't fail.
 */
export type PublishingBranchPush =
  | { readonly kind: "not-needed" }
  | { readonly kind: "pushed" }
  | { readonly kind: "failed"; readonly reason: string };

/** GitHub's words when credentials without the `workflow` scope push a change to workflows. */
/** An OAuth App's token lacks the `workflow` scope, or a GitHub App's the `workflows` permission. */
const MISSING_WORKFLOW_PERMISSION = /without [`']?workflows?[`']? (scope|permission)/i;
const NOT_A_FAST_FORWARD = /\[rejected\]|non-fast-forward|fetch first/i;

/** Why a push failed, in words for the user, with what git said (research §5). */
export function pushFailure(branch: string, target: RemoteBranch, said: string): string {
  const where = `${target.branch} on ${target.remote}`;
  if (MISSING_WORKFLOW_PERMISSION.test(said)) {
    return `GitHub refused the push of ${branch} to ${where}: the change touches .github/workflows, which needs the GitHub App's Workflows permission. Accept the App's permissions on GitHub if it asks, or register it again from Settings › Office identity, then run Publish again. git said: ${said}`;
  }
  if (NOT_A_FAST_FORWARD.test(said)) {
    return `${target.remote} refused the push of ${branch} to ${where}: it has commits the Task's branch doesn't. git said: ${said}`;
  }
  return `Pushing ${branch} to ${where} failed. git said: ${said}`;
}

/** Why the branch no longer applies cleanly on the base as its remote has it. */
export function baseMovedError(
  branch: string,
  base: RemoteBranch,
  conflictedFiles: readonly string[],
): string {
  const where = `${base.branch} on ${base.remote}`;
  if (conflictedFiles.length > 0) {
    const files = conflictedFiles.map((file) => `- ${file}`).join("\n");
    return `${branch} no longer applies cleanly on ${where}: it would conflict in\n${files}`;
  }
  return `${branch} no longer applies cleanly on ${where}.`;
}

/** Publish pushes to the remote the base branch tracks, so a base tracking none can't publish. */
/** Push + PR stopped before the push, as no pull request could be opened on the base's remote. */
export function pullRequestBlockedError(branch: string, base: RemoteBranch, why: string): string {
  return `Push + PR didn't push ${branch} to ${base.remote}: ${why} Then run Publish again, or change the Project's publishing mode to merge.`;
}

export function noRemoteError(baseBranch: string): string {
  return `${baseBranch} tracks no remote branch, so Publish has nowhere to push. Set its upstream (\`git branch --set-upstream-to=origin/${baseBranch} ${baseBranch}\`), then run Publish again.`;
}
