import type { PullRequest } from "../domain/pull-request.js";

/** Where the pull requests The Office opened are kept. */
export abstract class PullRequestRepository {
  /**
   * Keeps a pull request just opened or adopted. One already kept for its remote and number is
   * updated instead, keeping its id and the status last read, and is open again; gives what is kept.
   */
  abstract record(pullRequest: PullRequest): Promise<PullRequest>;

  /** Saves a kept pull request as given, by its id. */
  abstract save(pullRequest: PullRequest): Promise<void>;

  /** The open pull requests (no `endedAt`), newest first; only the Project's when one is named. */
  abstract listOpen(projectId?: string): Promise<readonly PullRequest[]>;

  /** The pull request kept for the remote's `number`, open or ended; undefined when none is. */
  abstract find(remoteUrl: string, number: number): Promise<PullRequest | undefined>;
}
