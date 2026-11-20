import { Injectable } from "@nestjs/common";
import { GitHubAccessFailed, NotSignedInWithGitHub } from "../domain/github-repository.js";
import { repositoryOnGitHubOf, type RepositoryOnGitHub } from "../domain/pull-request.js";
import { GitHubApi, type IssueCloseReason, type IssueOnGitHubApi } from "../ports/github-api.js";
import { failedAccess, GitHubAccess } from "./github-access.js";
import { GitHubUrls } from "./github-urls.js";

/** An issue on GitHub, never a pull request. */
export interface IssueOnGitHub {
  readonly number: number;
  readonly title: string;
  /** Markdown; empty when it has none. */
  readonly body: string;
  readonly url: string;
  readonly author: { readonly login: string; readonly url: string };
  readonly labels: readonly string[];
  readonly openedAt: Date;
}

/** Where an issue stands on GitHub. */
export type IssueStateOnGitHub =
  { readonly state: "open" } | { readonly state: "closed"; readonly closedAt: Date };

/** An issue read on its own, with where it stands. */
export interface FoundIssueOnGitHub extends IssueOnGitHub {
  readonly state: IssueStateOnGitHub;
}

/** Which open issues to list. */
export interface OpenIssuesOnGitHub {
  /** Only those with this label, in any case. */
  readonly label?: string | undefined;
  readonly order: "oldest-first" | "newest-first";
  /** The most to list. */
  readonly most: number;
}

export type { IssueCloseReason };

/**
 * Issues on GitHub, listed, read, commented on and closed through its REST API as the signed-in
 * user, for Projects' GitHub issues (docs/design/issues-as-tasks.html). GitHub's issues API lists
 * pull requests too; they are left out everywhere here. Every call throws `NotSignedInWithGitHub`
 * while signed out and `GitHubAccessFailed`, in GitHub's words where it gives them, when the
 * remote isn't on GitHub or GitHub refuses or fails.
 */
@Injectable()
export class GitHubIssues {
  constructor(
    private readonly api: GitHubApi,
    private readonly access: GitHubAccess,
    private readonly urls: GitHubUrls,
  ) {}

  /** Whether the remote is a repository on GitHub's website, asking no one. */
  reaches(remoteUrl: string): boolean {
    return repositoryOnGitHubOf(remoteUrl, this.urls.web) !== undefined;
  }

  /** The remote's open issues, pull requests left out, as `listing` asks. */
  async openIssues(
    remoteUrl: string,
    { label, order, most }: OpenIssuesOnGitHub,
  ): Promise<readonly IssueOnGitHub[]> {
    const { repository, token } = await this.reading(remoteUrl);
    const listed = await this.api
      .openIssuesOf(token, repository, {
        label,
        direction: order === "oldest-first" ? "asc" : "desc",
        most,
      })
      .catch(failedAccess);
    return listed.map(issueOf);
  }

  /** Issue `number` with where it stands; undefined when there is no such issue, or it is a pull request. */
  async issue(remoteUrl: string, number: number): Promise<FoundIssueOnGitHub | undefined> {
    const { repository, token } = await this.reading(remoteUrl);
    const found = await this.api.issueOf(token, repository, number).catch(failedAccess);
    if (found === undefined) return undefined;
    const state: IssueStateOnGitHub =
      found.state === "closed"
        ? { state: "closed", closedAt: new Date(found.closedAt ?? found.createdAt) }
        : { state: "open" };
    return { ...issueOf(found), state };
  }

  /** Comments on issue `number`, in Markdown. */
  async comment(remoteUrl: string, number: number, body: string): Promise<void> {
    const { repository, token } = await this.reading(remoteUrl);
    await this.api.commentOnIssue(token, repository, number, body).catch(failedAccess);
  }

  /** Closes issue `number` as `reason`; one already closed is closed again, which changes nothing. */
  async close(remoteUrl: string, number: number, reason: IssueCloseReason): Promise<void> {
    const { repository, token } = await this.reading(remoteUrl);
    await this.api.closeIssue(token, repository, number, reason).catch(failedAccess);
  }

  /** The remote's repository on GitHub and the token to ask with. */
  private async reading(
    remoteUrl: string,
  ): Promise<{ readonly repository: RepositoryOnGitHub; readonly token: string }> {
    const repository = repositoryOnGitHubOf(remoteUrl, this.urls.web);
    if (repository === undefined) {
      throw new GitHubAccessFailed(
        `The remote isn't a repository on ${new URL(this.urls.web).host}, and The Office reads issues on GitHub only.`,
      );
    }
    const token = await this.access.userToken();
    if (token === undefined) throw new NotSignedInWithGitHub();
    return { repository, token };
  }
}

function issueOf(issue: IssueOnGitHubApi): IssueOnGitHub {
  return {
    number: issue.number,
    title: issue.title,
    body: issue.body,
    url: issue.url,
    author: { login: issue.authorLogin, url: issue.authorUrl },
    labels: issue.labels,
    openedAt: new Date(issue.createdAt),
  };
}
