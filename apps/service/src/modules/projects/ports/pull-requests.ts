/** What a pull request asks: to merge `branch` into `baseBranch`, in the record's words. */
export interface PullRequestRequest {
  /** The URL of the remote the branch was pushed to, as git resolves it. */
  readonly remoteUrl: string;
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
 * The host that keeps the Project's pull requests, asked as the user signed in with GitHub by
 * Office code only (spec §5.5 Defaults). Throws PullRequestRefused when it refuses.
 */
export abstract class PullRequests {
  /**
   * Why no pull request can be opened on the remote at `remoteUrl`, asked before the push so a
   * Publish that couldn't open one pushes nothing; undefined when one can be.
   */
  abstract whyCannotOpen(remoteUrl: string): Promise<string | undefined>;

  /** Opens the pull request, or finds the one already open for the branch. */
  abstract open(request: PullRequestRequest): Promise<PullRequest>;
}
