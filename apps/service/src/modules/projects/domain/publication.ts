/** The words a pull request opens with: the Task's title and its record (spec §2.3). */
export interface PullRequestText {
  readonly title: string;
  /** Markdown. */
  readonly body: string;
}

/** A branch on a remote. */
export interface RemoteBranch {
  readonly remote: string;
  readonly branch: string;
}

/**
 * How a Publish ended, by the Project's publishing mode (spec §9): the Task's branch pushed with a
 * pull request open, or merged into the base branch on its remote; nothing to publish; the base
 * moved on so the branch would conflict with it, which the user decides about; or a failure,
 * such as a refused push, in words for the Agent who repairs it or the user.
 */
export type Publication =
  | { readonly kind: "pull-request-opened"; readonly branch: string; readonly url: string }
  | {
      readonly kind: "merged";
      readonly branch: string;
      readonly into: RemoteBranch;
      readonly commit: string;
      /** Whether The Office rebased the branch onto the base first, as the base had moved on. */
      readonly rebased: boolean;
    }
  | { readonly kind: "nothing-to-publish"; readonly branch: string; readonly base: RemoteBranch }
  | {
      readonly kind: "base-moved";
      readonly error: string;
      /** The files it would conflict in. */
      readonly conflictedFiles: readonly string[];
    }
  | { readonly kind: "failed"; readonly error: string };

/** GitHub's words when credentials without the `workflow` scope push a change to workflows. */
const MISSING_WORKFLOW_SCOPE = /without [`']?workflow[`']? scope/i;
const NOT_A_FAST_FORWARD = /\[rejected\]|non-fast-forward|fetch first/i;

/** Why a push failed, in words for the user, with what git said (research §5). */
export function pushFailure(branch: string, target: RemoteBranch, said: string): string {
  const where = `${target.branch} on ${target.remote}`;
  if (MISSING_WORKFLOW_SCOPE.test(said)) {
    return `GitHub refused the push of ${branch} to ${where}: the change touches .github/workflows, which needs credentials with the \`workflow\` scope, and yours lack it. Add the scope with \`gh auth refresh -s workflow\` (or use a token that has it), then run Publish again. git said: ${said}`;
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
export function noRemoteError(baseBranch: string): string {
  return `${baseBranch} tracks no remote branch, so Publish has nowhere to push. Set its upstream (\`git branch --set-upstream-to=origin/${baseBranch} ${baseBranch}\`), then run Publish again.`;
}
