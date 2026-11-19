export type PullRequestState = "open" | "merged" | "closed";
/** Failing wins over pending, pending over passing, passing over none; unknown when unreadable. */
export type PullRequestChecks = "passing" | "failing" | "pending" | "none" | "unknown";
export type PullRequestMergeable = "yes" | "conflicts" | "unknown";

/** Where one pull request stands on its code host, in host-neutral words. */
export interface PullRequestStatus {
  readonly state: PullRequestState;
  readonly checks: PullRequestChecks;
  readonly mergeable: PullRequestMergeable;
  readonly headCommit: string;
  readonly baseCommit: string;
}

/** The commits a pull request's branch and base are at, as its code host lists it. */
export interface ListedCommits {
  readonly headCommit: string;
  readonly baseCommit: string;
}

/**
 * A pull request The Office opened, recorded at Publish (or adopted from its code host's list by
 * its `office/<task id>` branch) and kept up to date by the pull request watch.
 */
export interface PullRequest {
  readonly id: string;
  readonly projectId: string;
  /** The Task that opened it, by id alone: its record may go while the pull request stays. */
  readonly taskId: string;
  /** The URL of the remote it was opened on, as git resolves it; with `number`, which one it is. */
  readonly remoteUrl: string;
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly branch: string;
  readonly baseBranch: string;
  readonly openedAt: Date;
  readonly state: PullRequestState;
  readonly checks: PullRequestChecks;
  readonly mergeable: PullRequestMergeable;
  /** The commits its status was last read at; null before the first read. */
  readonly headCommit: string | null;
  readonly baseCommit: string | null;
  /** When its status was last read; null before the first read. */
  readonly checkedAt: Date | null;
  /** When it was found merged or closed; null while open. */
  readonly endedAt: Date | null;
  /** True while the last refresh couldn't read it, so its status may be out of date. */
  readonly stale: boolean;
}

export type OpenedPullRequestFields = Pick<
  PullRequest,
  | "id"
  | "projectId"
  | "taskId"
  | "remoteUrl"
  | "number"
  | "url"
  | "title"
  | "branch"
  | "baseBranch"
  | "openedAt"
>;

/** A pull request just opened: open, its status not read yet. */
export function openedPullRequest(fields: OpenedPullRequestFields): PullRequest {
  return {
    ...fields,
    state: "open",
    checks: "unknown",
    mergeable: "unknown",
    headCommit: null,
    baseCommit: null,
    checkedAt: null,
    endedAt: null,
    stale: false,
  };
}

const TASK_BRANCH = /^office\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** The Task id an `office/<task id>` branch names; undefined for any other branch. */
export function taskIdOfBranch(branch: string): string | undefined {
  return TASK_BRANCH.exec(branch)?.[1]?.toLowerCase();
}

/**
 * Whether the status must be read again: never read, its branch or base moved since the read,
 * or the code host hadn't finished working it out (checks pending or unknown, mergeable unknown).
 * Anything else stays as it was read, which keeps a refresh to one list per Project.
 */
export function needsStatus(pullRequest: PullRequest, listed: ListedCommits): boolean {
  return (
    pullRequest.checkedAt === null ||
    pullRequest.headCommit !== listed.headCommit ||
    pullRequest.baseCommit !== listed.baseCommit ||
    pullRequest.checks === "pending" ||
    pullRequest.checks === "unknown" ||
    pullRequest.mergeable === "unknown"
  );
}

/** A pull request after a read of its status, and whether anything the list shows changed. */
export interface StatusRead {
  readonly pullRequest: PullRequest;
  /** False when only the time of the read moved, which nobody needs to hear of. */
  readonly changed: boolean;
}

/** The pull request with the status read at `at`, ended then when it is no longer open. */
export function withStatus(
  pullRequest: PullRequest,
  status: PullRequestStatus,
  at: Date,
): StatusRead {
  const ended = status.state !== "open";
  const changed =
    pullRequest.state !== status.state ||
    pullRequest.checks !== status.checks ||
    pullRequest.mergeable !== status.mergeable ||
    pullRequest.headCommit !== status.headCommit ||
    pullRequest.baseCommit !== status.baseCommit ||
    pullRequest.checkedAt === null ||
    pullRequest.stale ||
    (pullRequest.endedAt !== null) !== ended;
  return {
    pullRequest: {
      ...pullRequest,
      state: status.state,
      checks: status.checks,
      mergeable: status.mergeable,
      headCommit: status.headCommit,
      baseCommit: status.baseCommit,
      checkedAt: at,
      endedAt: ended ? (pullRequest.endedAt ?? at) : null,
      stale: false,
    },
    changed,
  };
}

/** Whether a pull request is shown in the list: open, as far as The Office last knew. */
export function isOpen(pullRequest: PullRequest): boolean {
  return pullRequest.endedAt === null;
}
