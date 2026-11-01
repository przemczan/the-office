import { Injectable } from "@nestjs/common";
import { NotSignedInWithGitHub } from "../domain/github-repository.js";
import {
  PullRequestNotOpened,
  pullRequestRefusal,
  repositoryOnGitHubOf,
  type PullRequestToOpen,
  type RepositoryOnGitHub,
} from "../domain/pull-request.js";
import { GitHubApi } from "../ports/github-api.js";
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

/**
 * Pull requests on GitHub, opened through its REST API as the signed-in user (spec §5.5 Defaults):
 * without the sign-in there are none.
 */
@Injectable()
export class GitHubPullRequests {
  constructor(
    private readonly api: GitHubApi,
    private readonly access: GitHubAccess,
    private readonly urls: GitHubUrls,
  ) {}

  /**
   * Why no pull request can be opened on the remote, without asking GitHub or refreshing the token:
   * it isn't a repository on GitHub, or the user isn't signed in. Undefined when one can be.
   */
  async whyCannotOpen(remoteUrl: string): Promise<string | undefined> {
    if (repositoryOnGitHubOf(remoteUrl, this.urls.web) === undefined) {
      return this.notOnGitHub();
    }
    return (await this.access.isSignedIn())
      ? undefined
      : "Pull requests are opened as the user signed in with GitHub, and no one is signed in. Sign in with GitHub in Settings › Office identity.";
  }

  /**
   * Opens the pull request and gives its web address; when GitHub refuses it as one is already open
   * for the branch, gives that one's. Throws `PullRequestNotOpened` when GitHub refuses,
   * `NotSignedInWithGitHub` while signed out and `GitHubAccessFailed` when GitHub can't be reached.
   */
  async open({ remoteUrl, base, head, title, body }: PullRequestOnRemote): Promise<string> {
    const repository = repositoryOnGitHubOf(remoteUrl, this.urls.web);
    if (repository === undefined) throw new PullRequestNotOpened(this.notOnGitHub());
    const token = await this.access.userToken();
    if (token === undefined) throw new NotSignedInWithGitHub();
    const pullRequest: PullRequestToOpen = { repository, base, head, title, body };
    const answer = await this.api.openPullRequest(token, pullRequest).catch(failedAccess);
    if (answer.kind === "opened") return answer.url;
    // GitHub's docs give 422 for both an open pull request and others, such as no commits between.
    const open =
      answer.status === 422 ? await this.openOne(token, repository, head, base) : undefined;
    if (open !== undefined) return open;
    throw new PullRequestNotOpened(pullRequestRefusal(answer.status, answer.reasons, pullRequest));
  }

  private openOne(
    token: string,
    repository: RepositoryOnGitHub,
    head: string,
    base: string,
  ): Promise<string | undefined> {
    return this.api.openPullRequestOf(token, repository, head, base).catch(failedAccess);
  }

  private notOnGitHub(): string {
    return `The remote isn't a repository on ${new URL(this.urls.web).host}, and The Office opens pull requests on GitHub only.`;
  }
}
