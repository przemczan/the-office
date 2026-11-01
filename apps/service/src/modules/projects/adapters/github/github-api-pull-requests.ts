import { Injectable } from "@nestjs/common";
import {
  GitHubAccessFailed,
  GitHubPullRequests,
  NotSignedInWithGitHub,
  PullRequestNotOpened,
} from "../../../github/index.js";
import {
  PullRequestRefused,
  PullRequests,
  type PullRequest,
  type PullRequestRequest,
} from "../../ports/pull-requests.js";

/** Pull requests on GitHub, opened by the github module through GitHub's REST API as the signed-in user. */
@Injectable()
export class GitHubApiPullRequests extends PullRequests {
  constructor(private readonly gitHub: GitHubPullRequests) {
    super();
  }

  whyCannotOpen(remoteUrl: string): Promise<string | undefined> {
    return this.gitHub.whyCannotOpen(remoteUrl);
  }

  async open({
    remoteUrl,
    baseBranch,
    branch,
    title,
    body,
  }: PullRequestRequest): Promise<PullRequest> {
    try {
      return {
        url: await this.gitHub.open({ remoteUrl, base: baseBranch, head: branch, title, body }),
      };
    } catch (error) {
      if (
        error instanceof PullRequestNotOpened ||
        error instanceof NotSignedInWithGitHub ||
        error instanceof GitHubAccessFailed
      ) {
        throw new PullRequestRefused(error.message);
      }
      throw error;
    }
  }
}
