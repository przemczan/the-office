import type {
  MergeMethod,
  PullRequest,
  PullRequestChecks,
  PullRequestEnd,
  PullRequestMergeable,
  PullRequestProblem,
  Role,
} from "@the-office/contracts";
import { clockOf, dayAndClockOf, durationWords, momentWords } from "../../shell/time.ts";
import type { ToneWords } from "../../shell/tone-words.ts";
import { authorName } from "../../shell/work/work-words.ts";

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

/** The row's actions, each opening its window. */
export const MERGE_ACTION = "Merge…";
export const CLOSE_ACTION = "Close…";

/** Each merge method as the Merge window offers it, in GitHub's own words. */
export const MERGE_METHOD_WORDS: Readonly<Record<MergeMethod, string>> = {
  merge: "Create a merge commit",
  squash: "Squash and merge",
  rebase: "Rebase and merge",
};

/** Each merge method as a Task's badge names it: "Merged (squash)". */
const MERGE_METHOD_SHORT: Readonly<Record<MergeMethod, string>> = {
  merge: "merge commit",
  squash: "squash",
  rebase: "rebase",
};

/** "Merge #42 Add the sign-in page". */
export function mergeTitle(pullRequest: Pick<PullRequest, "number" | "title">): string {
  return `Merge ${pullRequestName(pullRequest)}`;
}

/** "office/1f2e… goes into main." */
export function mergeIntoWords(pullRequest: Pick<PullRequest, "branch" | "baseBranch">): string {
  return `${pullRequest.branch} goes into ${pullRequest.baseBranch}.`;
}

export const MERGE_BUTTON = "Merge pull request";
export const MERGE_METHOD_LABEL = "Merge method";
export const MERGE_REFUSED = "The pull request wasn't merged";
export const MERGE_METHODS_UNREAD = "The merge methods can't be read";

/**
 * Whether the branch goes once merged: The Office deletes it when its Project's Delete branches
 * once merged is On; otherwise GitHub deletes it, it stays, or GitHub didn't say.
 */
export function branchDeletionWords(
  deletesBranchOnMerge: boolean | null,
  officeDeletesMergedBranches: boolean,
): string {
  if (officeDeletesMergedBranches) return "The Office deletes the branch once it is merged.";
  if (deletesBranchOnMerge === true) return "GitHub deletes the branch once it is merged.";
  if (deletesBranchOnMerge === false) return "The branch stays after the merge.";
  return "The Office doesn't delete the branch; GitHub deletes it only if the repository is set to.";
}

/**
 * The caution over a merge whose checks fail or that conflicts, or undefined when there is none;
 * the merge can still be tried.
 */
export function mergeCautionTitle(
  pullRequest: Pick<PullRequest, "checks" | "mergeable">,
): string | undefined {
  const failing = pullRequest.checks === "failing";
  const conflicts = pullRequest.mergeable === "conflicts";
  if (failing && conflicts) return "Checks are failing and it has conflicts";
  if (failing) return "Checks are failing";
  if (conflicts) return "It has conflicts with its base";
  return undefined;
}

export const MERGE_CAUTION =
  "The merge can still be tried; GitHub refuses it when the base branch's rules don't allow it.";

/** "Close #42". */
export function closeTitle(pullRequest: Pick<PullRequest, "number">): string {
  return `Close #${pullRequest.number}`;
}

/** "Close #12 without merging? The branch stays, and it can be reopened on GitHub." */
export function closeQuestion(pullRequest: Pick<PullRequest, "number">): string {
  return `Close #${pullRequest.number} without merging? The branch stays, and it can be reopened on GitHub.`;
}

export const CLOSE_BUTTON = "Close pull request";
export const CLOSE_REFUSED = "The pull request wasn't closed";

/** The toast once it is done: "#42 merged." or "#42 closed.". */
export function endedToast(
  pullRequest: Pick<PullRequest, "number">,
  outcome: PullRequestEnd["outcome"],
): string {
  return `#${pullRequest.number} ${outcome}.`;
}

/** The Task's badge beside Open pull request. */
export const PULL_REQUEST_END_BADGE: Readonly<Record<PullRequestEnd["outcome"], string>> = {
  merged: "Pull request merged",
  closed: "Pull request closed",
};

/**
 * The badge's words on hover, when in the user's own time: "#12 merged (squash) by Ann Lee,
 * 19 Nov, 14:02", "#12 closed on GitHub, 19 Nov, 14:02".
 */
export function pullRequestEndWords(
  end: PullRequestEnd,
  roles: readonly Role[] | undefined,
  signedInUserId: string | undefined,
): string {
  const method = end.method === null ? "" : ` (${MERGE_METHOD_SHORT[end.method]})`;
  return `#${end.number} ${end.outcome}${method} ${endedByWords(end.by, roles, signedInUserId)}, ${dayAndClockOf(end.at)}`;
}

function endedByWords(
  by: PullRequestEnd["by"],
  roles: readonly Role[] | undefined,
  signedInUserId: string | undefined,
): string {
  if (by.kind === "code-host") return `on ${by.name}`;
  const name = authorName(by, roles, signedInUserId);
  return `by ${name === "You" ? "you" : name}`;
}
