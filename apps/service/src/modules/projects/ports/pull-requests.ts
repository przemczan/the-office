/** What a pull request asks: to merge `branch` into `baseBranch`, in the record's words. */
export interface PullRequestRequest {
  /** The repository whose remote the branch was pushed to. */
  readonly repositoryPath: string;
  readonly baseBranch: string;
  readonly branch: string;
  readonly title: string;
  /** Markdown. */
  readonly body: string;
}

/** A pull request the host holds. */
export interface PullRequest {
  readonly url: string;
}

/** The host refused to open a pull request, or couldn't be asked; `message` says why for the user. */
export class PullRequestRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PullRequestRefused";
  }
}

/**
 * The host that keeps the Project's pull requests, asked with the user's own credentials by Office
 * code only (spec §9). Throws PullRequestRefused when it refuses.
 */
export abstract class PullRequests {
  /** Opens the pull request, or finds the one already open for the branch. */
  abstract open(request: PullRequestRequest): Promise<PullRequest>;
}
