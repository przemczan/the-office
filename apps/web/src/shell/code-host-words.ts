import type {
  CiRun,
  CiRunProblem,
  PullRequest,
  PullRequestChecks,
  PullRequestMergeable,
  PullRequestProblem,
} from "@the-office/contracts";
import { clockOf, durationWords, momentWords } from "./time.ts";
import type { ToneWords } from "./tone-words.ts";

// What The Office reads from a Project's code host, in the words Work › CI, Work › Pull requests
// and a Project's Overview share.

/** "CI #118 · Add the sign-in page". */
export function ciRunName(run: Pick<CiRun, "workflow" | "number" | "title">): string {
  return `${run.workflow} #${run.number} · ${run.title}`;
}

/** The first seven characters of a commit. */
export function shortCommit(commit: string): string {
  return commit.slice(0, 7);
}

/**
 * Why a Project's CI runs weren't listed, in the user's own time: the code host's words, or "GitHub
 * couldn't be reached at 14:02."
 */
export function ciRunProblemWords(problem: CiRunProblem): string {
  if (problem.kind === "cannot-read") return problem.text;
  return `${problem.codeHost} couldn't be reached at ${clockOf(problem.failedAt)}.`;
}

/** A pull request's checks, taken together, as the Checks column shows them. */
export const CHECKS_WORDS: Readonly<Record<PullRequestChecks, ToneWords>> = {
  passing: { label: "Passing", tone: "success", title: "Every check passed." },
  failing: { label: "Failing", tone: "danger", title: "At least one check failed." },
  pending: { label: "Running", tone: "warning", title: "Checks are still running." },
  none: { label: "No checks", tone: "neutral", title: "No check runs on this pull request." },
  unknown: {
    label: "Can't read",
    tone: "neutral",
    title: "GitHub didn't let The Office read the checks. The App may lack a permission.",
  },
};

/** Whether a pull request merges into its base, as the Mergeable column shows it. */
export const MERGEABLE_WORDS: Readonly<Record<PullRequestMergeable, ToneWords>> = {
  yes: { label: "Can merge", tone: "success", title: "It merges into its base cleanly." },
  conflicts: {
    label: "Conflicts",
    tone: "danger",
    title: "It conflicts with its base; the conflicts are resolved before it can merge.",
  },
  unknown: {
    label: "Checking…",
    tone: "neutral",
    title: "GitHub hasn't worked out yet whether it merges.",
  },
};

/** "#42 Add the sign-in page". */
export function pullRequestName(pullRequest: Pick<PullRequest, "number" | "title">): string {
  return `#${pullRequest.number} ${pullRequest.title}`;
}

/**
 * Why a Project's pull requests weren't read, in the user's own time: the code host's words when it
 * refused to be read, or "GitHub couldn't be reached at 14:02; showing what it said at 13:58."
 */
export function pullRequestProblemWords(problem: PullRequestProblem): string {
  if (problem.kind === "cannot-read") return problem.text;
  const shown =
    problem.lastReadAt === null ? "" : `; showing what it said at ${clockOf(problem.lastReadAt)}`;
  return `${problem.codeHost} couldn't be reached at ${clockOf(problem.failedAt)}${shown}.`;
}

/**
 * When something was last read: "18 min ago", "<1 min ago" within the day, "9 Nov, 10:05" before,
 * or "Not checked yet".
 */
export function checkedWords(checkedAt: string | null, now: Date = new Date()): string {
  if (checkedAt === null) return "Not checked yet";
  const since = Math.max(0, now.getTime() - new Date(checkedAt).getTime());
  return since < DAY_MS ? `${durationWords(since)} ago` : momentWords(checkedAt, now);
}

const DAY_MS = 24 * 60 * 60_000;
