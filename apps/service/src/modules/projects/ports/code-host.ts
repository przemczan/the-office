import type { PullRequestStatus } from "../domain/pull-request.js";

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

/** A pull request the code host holds, by its number in the repository and its web address. */
export interface OpenedPullRequest {
  readonly number: number;
  readonly url: string;
}

/** An open pull request as the code host lists it. */
export interface PullRequestOnHost extends OpenedPullRequest {
  readonly title: string;
  readonly branch: string;
  readonly baseBranch: string;
  readonly headCommit: string;
  readonly baseCommit: string;
}

/** The code host refused, or couldn't be asked; `message` says why for the user. */
export class CodeHostRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodeHostRefused";
  }
}

/**
 * A host that keeps Projects' pull requests, asked as the user signed in to it by Office code
 * only (spec §5.5 Defaults). `CodeHosts` picks the one for a remote by its URL (`reaches`). Throws
 * CodeHostRefused when it refuses or can't be reached.
 */
export abstract class CodeHost {
  /** The host's name in the user's words, such as GitHub. */
  abstract readonly name: string;

  /** Whether this host holds the repository at `remoteUrl`, without asking it. */
  abstract reaches(remoteUrl: string): boolean;

  /**
   * Why no pull request can be opened on the remote at `remoteUrl`, asked before the push so a
   * Publish that couldn't open one pushes nothing; undefined when one can be.
   */
  abstract whyCannotOpen(remoteUrl: string): Promise<string | undefined>;

  /** Opens the pull request, or finds the one already open for the branch. */
  abstract open(request: PullRequestRequest): Promise<OpenedPullRequest>;

  /**
   * Why the remote's pull requests can't be read now, such as no one signed in with a token valid
   * now, without asking the host; undefined when they can be. Never throws.
   */
  abstract whyCannotRead(remoteUrl: string): Promise<string | undefined>;

  /** Every open pull request of the repository at `remoteUrl`. */
  abstract openPullRequests(remoteUrl: string): Promise<readonly PullRequestOnHost[]>;

  /** Where pull request `number` of the repository stands now. */
  abstract pullRequestStatus(remoteUrl: string, number: number): Promise<PullRequestStatus>;
}
