/** Where a GitHub Actions run stands, in host-neutral words. */
export type GitHubCiRunStatus =
  "queued" | "waiting" | "running" | "succeeded" | "failed" | "cancelled" | "skipped" | "unknown";

/**
 * Maps GitHub's `status` and `conclusion` of a workflow run (docs.github.com/rest/actions/workflow-runs):
 * a run that isn't completed is by its status, a completed one by its conclusion.
 */
export function ciRunStatusOf(status: string | null, conclusion: string | null): GitHubCiRunStatus {
  switch (status) {
    case "queued":
    case "requested":
    case "pending":
      return "queued";
    case "waiting":
      return "waiting";
    case "in_progress":
      return "running";
    case "completed":
      return conclusionStatusOf(conclusion);
    default:
      return "unknown";
  }
}

function conclusionStatusOf(conclusion: string | null): GitHubCiRunStatus {
  switch (conclusion) {
    case "success":
    case "neutral":
      return "succeeded";
    case "failure":
    case "timed_out":
    case "startup_failure":
    case "action_required":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "skipped":
    case "stale":
      return "skipped";
    default:
      return "unknown";
  }
}
