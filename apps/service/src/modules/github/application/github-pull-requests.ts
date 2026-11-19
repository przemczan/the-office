import { Injectable } from "@nestjs/common";
import { GitHubAccessFailed, NotSignedInWithGitHub } from "../domain/github-repository.js";
import {
  PullRequestNotOpened,
  pullRequestRefusal,
  repositoryOnGitHubOf,
  type PullRequestToOpen,
  type RepositoryOnGitHub,
} from "../domain/pull-request.js";
import {
  checksOf,
  mergeableOf,
  pullRequestStateOf,
  type GitHubChecks,
  type GitHubMergeable,
  type GitHubPullRequestState,
} from "../domain/pull-request-status.js";
import { GitHubApi, type PullRequestOnGitHub } from "../ports/github-api.js";
import { failedAccess, GitHubAccess } from "./github-access.js";
import { GitHubUrls } from "./github-urls.js";

/** A pull request asked for by the remote the branch was pushed to, `head` into `base`. */
export interface PullRequestOnRemote {
  readonly remoteUrl: string;
  readonly base: string;
  readonly head: string;
  readonly title: string;
  /** Markdown. */
  readonly body: string;
}

/** A pull request GitHub holds, by its number in the repository and its web address. */
export interface OpenedPullRequestOnGitHub {
  readonly number: number;
  readonly url: string;
}

/** An open pull request as GitHub lists it: `branch` into `baseBranch`, and the commit each is at. */
export interface OpenPullRequestOnGitHub extends OpenedPullRequestOnGitHub {
  readonly title: string;
  readonly branch: string;
  readonly baseBranch: string;
  readonly headCommit: string;
  readonly baseCommit: string;
}

/** Where one pull request stands on GitHub now. */
export interface PullRequestStatusOnGitHub {
  readonly state: GitHubPullRequestState;
  readonly checks: GitHubChecks;
  readonly mergeable: GitHubMergeable;
  readonly headCommit: string;
  readonly baseCommit: string;
}

/**
 * Pull requests on GitHub, opened and read through its REST API as the signed-in user (spec §5.5
 * Defaults): without the sign-in there are none.
 */
@Injectable()
export class GitHubPullRequests {
  constructor(
    private readonly api: GitHubApi,
    private readonly access: GitHubAccess,
    private readonly urls: GitHubUrls,
  ) {}

  /** Whether the remote is a repository on GitHub's website, asking no one. */
  reaches(remoteUrl: string): boolean {
    return repositoryOnGitHubOf(remoteUrl, this.urls.web) !== undefined;
  }

  /**
   * Why no pull request can be opened on the remote, without asking GitHub or refreshing the token:
   * it isn't a repository on GitHub, or the user isn't signed in. Undefined when one can be.
   */
  async whyCannotOpen(remoteUrl: string): Promise<string | undefined> {
    if (!this.reaches(remoteUrl)) return this.notOnGitHub();
    return (await this.access.isSignedIn())
      ? undefined
      : "Pull requests are opened as the user signed in with GitHub, and no one is signed in. Sign in with GitHub in Settings › Office identity.";
  }

  /**
   * Why the remote's pull requests can't be read now: it isn't a repository on GitHub, no one is
   * signed in, or the token couldn't be renewed (GitHub unreachable, or refusing it, which signs the
   * user out). Undefined when they can be. Asks GitHub only to renew a token about to expire; never
   * throws for GitHub.
   */
  async whyCannotRead(remoteUrl: string): Promise<string | undefined> {
    if (!this.reaches(remoteUrl)) return this.notOnGitHub();
    try {
      return (await this.access.userToken()) === undefined
        ? "Pull requests are read as the user signed in with GitHub, and no one is signed in. Sign in with GitHub in Settings › Office identity."
        : undefined;
    } catch (error) {
      if (error instanceof GitHubAccessFailed) return error.reason;
      throw error;
    }
  }

  /**
   * Opens the pull request and gives it; when GitHub refuses it as one is already open for the
   * branch, gives that one. Throws `PullRequestNotOpened` when GitHub refuses,
   * `NotSignedInWithGitHub` while signed out and `GitHubAccessFailed` when GitHub can't be reached.
   */
  async open({
    remoteUrl,
    base,
    head,
    title,
    body,
  }: PullRequestOnRemote): Promise<OpenedPullRequestOnGitHub> {
    const repository = repositoryOnGitHubOf(remoteUrl, this.urls.web);
    if (repository === undefined) throw new PullRequestNotOpened(this.notOnGitHub());
    const token = await this.access.userToken();
    if (token === undefined) throw new NotSignedInWithGitHub();
    const pullRequest: PullRequestToOpen = { repository, base, head, title, body };
    const answer = await this.api.openPullRequest(token, pullRequest).catch(failedAccess);
    if (answer.kind === "opened") return { number: answer.number, url: answer.url };
    // GitHub's docs give 422 for both an open pull request and others, such as no commits between.
    const open =
      answer.status === 422 ? await this.openOne(token, repository, head, base) : undefined;
    if (open !== undefined) return open;
    throw new PullRequestNotOpened(pullRequestRefusal(answer.status, answer.reasons, pullRequest));
  }

  /**
   * Every open pull request of the remote's repository. Throws `NotSignedInWithGitHub` while signed
   * out and `GitHubAccessFailed` when the remote isn't on GitHub or GitHub fails.
   */
  async openPullRequests(remoteUrl: string): Promise<readonly OpenPullRequestOnGitHub[]> {
    const { repository, token } = await this.reading(remoteUrl);
    const listed = await this.api.openPullRequestsOf(token, repository).catch(failedAccess);
    return listed.map((pullRequest) => ({
      number: pullRequest.number,
      url: pullRequest.url,
      title: pullRequest.title,
      branch: pullRequest.head,
      baseBranch: pullRequest.base,
      headCommit: pullRequest.headSha,
      baseCommit: pullRequest.baseSha,
    }));
  }

  /**
   * Where pull request `number` of the remote's repository stands: its state, its head commit's
   * checks (unknown when GitHub won't show them) and whether it merges cleanly. Throws as
   * `openPullRequests` does.
   */
  async status(remoteUrl: string, number: number): Promise<PullRequestStatusOnGitHub> {
    const { repository, token } = await this.reading(remoteUrl);
    const pullRequest = await this.api.pullRequestOf(token, repository, number).catch(failedAccess);
    const checks = await this.api
      .checksOf(token, repository, pullRequest.headSha)
      .catch(failedAccess);
    return {
      state: pullRequestStateOf(pullRequest.state, pullRequest.mergedAt),
      checks: checksOf(checks),
      mergeable: mergeableOf(pullRequest.mergeable),
      headCommit: pullRequest.headSha,
      baseCommit: pullRequest.baseSha,
    };
  }

  /** The remote's repository on GitHub and the token to read it with. */
  private async reading(
    remoteUrl: string,
  ): Promise<{ readonly repository: RepositoryOnGitHub; readonly token: string }> {
    const repository = repositoryOnGitHubOf(remoteUrl, this.urls.web);
    if (repository === undefined) throw new GitHubAccessFailed(this.notOnGitHub());
    const token = await this.access.userToken();
    if (token === undefined) throw new NotSignedInWithGitHub();
    return { repository, token };
  }

  private openOne(
    token: string,
    repository: RepositoryOnGitHub,
    head: string,
    base: string,
  ): Promise<PullRequestOnGitHub | undefined> {
    return this.api.openPullRequestOf(token, repository, head, base).catch(failedAccess);
  }

  private notOnGitHub(): string {
    return `The remote isn't a repository on ${new URL(this.urls.web).host}, and The Office opens pull requests on GitHub only.`;
  }
}
