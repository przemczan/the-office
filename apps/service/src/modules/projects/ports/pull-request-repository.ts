import type { PullRequest } from "../domain/pull-request.js";

/** Where the pull requests The Office opened are kept. */
export abstract class PullRequestRepository {
  /**
   * Keeps a pull request just opened or adopted. One already kept for its remote and number is
   * updated instead, keeping its id and the status last read, and is open again; gives what is kept.
   */
  abstract record(pullRequest: PullRequest): Promise<PullRequest>;

  /**
   * Saves a kept pull request's status as read (checks, mergeable, commits, when read, stale), by
   * its id. Never its state or end: only `end` and `reopen` change those, each on a condition, so
   * a save from a read begun before a merge can't open the row again.
   */
  abstract save(pullRequest: PullRequest): Promise<void>;

  /**
   * Ends the pull request merged or closed at `at`, only while it is open (no `endedAt`): gives the
   * ended row, or undefined when it wasn't open or isn't kept, so whoever saw the end first, the
   * user's Merge or the watch, announces it, and only once.
   */
  abstract end(id: string, state: "merged" | "closed", at: Date): Promise<PullRequest | undefined>;

  /** Opens an ended pull request again (no `endedAt`, state open); true when it was ended. */
  abstract reopen(id: string): Promise<boolean>;

  /** The pull request kept by its id, open or ended; undefined when none is. */
  abstract findById(id: string): Promise<PullRequest | undefined>;

  /** The open pull requests (no `endedAt`), newest first; only the Project's when one is named. */
  abstract listOpen(projectId?: string): Promise<readonly PullRequest[]>;

  /** The pull request kept for the remote's `number`, open or ended; undefined when none is. */
  abstract find(remoteUrl: string, number: number): Promise<PullRequest | undefined>;
}
