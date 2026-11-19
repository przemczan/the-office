import type {
  PullRequest,
  PullRequestChecks,
  PullRequestMergeable,
  PullRequestProblem,
} from "@the-office/contracts";
import { clockOf, durationWords, momentWords } from "../../shell/time.ts";

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

/** A status as a badge: its label, the badge's tone and what it means. */
export interface ToneWords {
  readonly label: string;
  readonly tone: Tone;
  /** What the label means, on hover. */
  readonly title: string;
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

export const TASK_NOT_FOUND = "Task not found";

export const REFRESH_HINT =
  "Read from GitHub every minute, and on Refresh. Merged and closed ones leave the list.";

export const OUT_OF_DATE = "Out of date";
export const OUT_OF_DATE_TITLE =
  "The last refresh couldn't read this pull request, so what it shows may be out of date.";

export const NO_PULL_REQUESTS =
  "No open pull requests. A Task whose Project publishes by pushing and opening a pull request opens one at Publish; it shows here until it is merged or closed.";

/** "#42 Add the sign-in page". */
export function pullRequestName(pullRequest: Pick<PullRequest, "number" | "title">): string {
  return `#${pullRequest.number} ${pullRequest.title}`;
}

/** "office/1f2e… → main". */
export function branchWords(pullRequest: Pick<PullRequest, "branch" | "baseBranch">): string {
  return `${pullRequest.branch} → ${pullRequest.baseBranch}`;
}

/**
 * When its status was last read: "18 min ago", "<1 min ago" within the day, "9 Nov, 10:05" before,
 * or "Not checked yet".
 */
export function checkedWords(checkedAt: string | null, now: Date = new Date()): string {
  if (checkedAt === null) return "Not checked yet";
  const since = Math.max(0, now.getTime() - new Date(checkedAt).getTime());
  return since < DAY_MS ? `${durationWords(since)} ago` : momentWords(checkedAt, now);
}

const DAY_MS = 24 * 60 * 60_000;

/** The line over a Project's problem: "<Project>'s pull requests weren't refreshed". */
export function problemTitle(projectName: string): string {
  return `${projectName}'s pull requests weren't refreshed`;
}

/**
 * Why, in the user's own time: the code host's words when it refused to be read, or "GitHub
 * couldn't be reached at 14:02; showing what it said at 13:58."
 */
export function problemWords(problem: PullRequestProblem): string {
  if (problem.kind === "cannot-read") return problem.text;
  const shown =
    problem.lastReadAt === null ? "" : `; showing what it said at ${clockOf(problem.lastReadAt)}`;
  return `${problem.codeHost} couldn't be reached at ${clockOf(problem.failedAt)}${shown}.`;
}

/** The note of how many the Project filter leaves out. */
export const IN_OTHER_PROJECTS = { one: "pull request", many: "pull requests" } as const;
