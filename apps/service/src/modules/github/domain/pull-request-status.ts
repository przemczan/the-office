/** Where a pull request stands on GitHub: open, merged, or closed without merging. */
export type GitHubPullRequestState = "open" | "merged" | "closed";

/** Its head commit's checks: failing wins over pending, pending over passing, passing over none. */
export type GitHubChecks = "passing" | "failing" | "pending" | "none" | "unknown";

/** Whether it merges into its base without conflicts; unknown while GitHub hasn't worked it out. */
export type GitHubMergeable = "yes" | "conflicts" | "unknown";

/** One check run on a commit, as GitHub gives it (docs.github.com/rest/checks/runs). */
export interface CheckRunOnGitHub {
  /** `queued`, `in_progress`, `completed`, and others GitHub may add, such as `waiting`. */
  readonly status: string;
  /** Set once `completed`: `success`, `failure`, `neutral`, `cancelled`, `skipped`, … */
  readonly conclusion: string | null;
}

/** One commit status, the latest of its context (docs.github.com/rest/commits/statuses). */
export interface CommitStatusOnGitHub {
  /** `error`, `failure`, `pending` or `success`. */
  readonly state: string;
}

/**
 * A commit's check runs and commit statuses, or unreadable when GitHub refused to show them, as it
 * does to an installation without the Checks or Commit statuses permission.
 */
export type ChecksOnGitHub =
  | {
      readonly kind: "read";
      readonly runs: readonly CheckRunOnGitHub[];
      readonly statuses: readonly CommitStatusOnGitHub[];
    }
  | { readonly kind: "unreadable" };

type Verdict = "passing" | "failing" | "pending";

const FAILING_CONCLUSIONS: ReadonlySet<string> = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
  "startup_failure",
]);
const PASSING_CONCLUSIONS: ReadonlySet<string> = new Set(["success", "neutral", "skipped"]);

/** The checks of a commit in one word: any failing makes them failing, else any pending pending. */
export function checksOf(checks: ChecksOnGitHub): GitHubChecks {
  if (checks.kind === "unreadable") return "unknown";
  const verdicts = [...checks.runs.map(checkRunVerdict), ...checks.statuses.map(statusVerdict)];
  if (verdicts.length === 0) return "none";
  if (verdicts.includes("failing")) return "failing";
  if (verdicts.includes("pending")) return "pending";
  return "passing";
}

/** GitHub's `mergeable`: null while it is still working it out, which a later read answers. */
export function mergeableOf(mergeable: boolean | null): GitHubMergeable {
  if (mergeable === null) return "unknown";
  return mergeable ? "yes" : "conflicts";
}

/** GitHub says `closed` for a merged pull request too; `merged_at` tells them apart. */
export function pullRequestStateOf(
  state: "open" | "closed",
  mergedAt: string | null,
): GitHubPullRequestState {
  if (state === "open") return "open";
  return mergedAt === null ? "closed" : "merged";
}

/**
 * A run not completed yet is pending. A completed run's conclusion GitHub doesn't list as passing or
 * failing, `stale` among them (a run left incomplete for 14 days, which GitHub ended), counts as
 * pending too: it never concluded, so the pull request isn't shown as passing on its account, and a
 * re-run settles it.
 */
function checkRunVerdict({ status, conclusion }: CheckRunOnGitHub): Verdict {
  if (status !== "completed" || conclusion === null) return "pending";
  if (FAILING_CONCLUSIONS.has(conclusion)) return "failing";
  return PASSING_CONCLUSIONS.has(conclusion) ? "passing" : "pending";
}

function statusVerdict({ state }: CommitStatusOnGitHub): Verdict {
  if (state === "failure" || state === "error") return "failing";
  return state === "success" ? "passing" : "pending";
}
