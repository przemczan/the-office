import { Injectable } from "@nestjs/common";
import { GitHubAccessFailed, NotSignedInWithGitHub } from "../domain/github-repository.js";
import {
  PullRequestNotOpened,
  pullRequestRefusal,
  repositoryOnGitHubOf,
  type PullRequestToOpen,
  type RepositoryOnGitHub,
} from "../domain/pull-request.js";
import { ciRunStatusOf, type GitHubCiRunStatus } from "../domain/ci-run-status.js";
import {
  checksOf,
  mergeableOf,
  pullRequestStateOf,
  type GitHubChecks,
  type GitHubMergeable,
  type GitHubPullRequestState,
} from "../domain/pull-request-status.js";
import {
  allowedMergeMethodsOf,
  closeRefusal,
  GITHUB_UNREACHABLE,
  mergeRefusal,
  PullRequestNotChanged,
  type GitHubMergeMethod,
} from "../domain/merge-refusal.js";
import {
  GitHubApi,
  GitHubUnreachable,
  type DispatchableWorkflowOnGitHub,
  type PullRequestOnGitHub,
  type RefsOnGitHub,
  type WorkflowDispatch,
} from "../ports/github-api.js";
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

/** A GitHub Actions run of a repository, in host-neutral words. */
export interface CiRunOnGitHub {
  readonly id: number;
  /** Its number among the workflow's runs. */
  readonly number: number;
  readonly attempt: number;
  /** The workflow's name. */
  readonly workflow: string;
  /** What GitHub titles it: the commit message or pull request title. */
  readonly title: string;
  /** What started it, such as `push` or `pull_request`. */
  readonly trigger: string;
  readonly branch: string | null;
  readonly commit: string;
  readonly status: GitHubCiRunStatus;
  readonly startedAt: Date | null;
  readonly updatedAt: Date;
  readonly url: string;
}

/** A workflow that can be started by hand at a ref, with the inputs its file declares there. */
export type ManualWorkflowOnGitHub = DispatchableWorkflowOnGitHub;

/** A repository's branches and tags, by name. */
export type RefsOfRepositoryOnGitHub = RefsOnGitHub;

/** A start by hand: the workflow by its file name, the branch or tag, and the inputs as strings. */
export type WorkflowStartOnGitHub = WorkflowDispatch;

/** The merge methods a repository allows, and whether GitHub deletes a branch once merged. */
export interface MergeMethodsOnGitHub {
  /** In GITHUB_MERGE_METHODS' order. */
  readonly allowed: readonly GitHubMergeMethod[];
  /** Undefined when GitHub doesn't say. */
  readonly deletesBranchOnMerge: boolean | undefined;
}

/** How to merge a pull request, and the head commit The Office last read of it. */
export interface MergeOnGitHub {
  readonly method: GitHubMergeMethod;
  readonly expectedHeadCommit: string;
}

/** A merged pull request, by the commit GitHub made on its base. */
export interface MergedOnGitHub {
  readonly commit: string;
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

  /**
   * The newest `count` GitHub Actions runs of the remote's repository, newest first. Throws as
   * `openPullRequests` does.
   */
  async recentRuns(remoteUrl: string, count: number): Promise<readonly CiRunOnGitHub[]> {
    const { repository, token } = await this.reading(remoteUrl);
    const runs = await this.api.workflowRunsOf(token, repository, count).catch(failedAccess);
    return runs.map((run) => ({
      id: run.id,
      number: run.runNumber,
      attempt: run.runAttempt,
      workflow: run.name,
      title: run.displayTitle,
      trigger: run.event,
      branch: run.headBranch,
      commit: run.headSha,
      status: ciRunStatusOf(run.status, run.conclusion),
      startedAt: run.runStartedAt === null ? null : new Date(run.runStartedAt),
      updatedAt: new Date(run.updatedAt),
      url: run.url,
    }));
  }

  /**
   * Runs the GitHub Actions run `runId` of the remote's repository again, or only its failed jobs.
   * Throws `NotSignedInWithGitHub` while signed out and `GitHubAccessFailed`, in GitHub's words,
   * when GitHub refuses (such as without the App's Actions permission) or fails.
   */
  async rerun(remoteUrl: string, runId: number, onlyFailed: boolean): Promise<void> {
    const { repository, token } = await this.reading(remoteUrl);
    await this.api.rerunWorkflowRun(token, repository, runId, onlyFailed).catch(failedAccess);
  }

  /**
   * The remote's repository's active workflows whose file at branch or tag `ref` declares
   * `workflow_dispatch`, with its inputs. Throws as `openPullRequests` does.
   */
  async manualWorkflows(
    remoteUrl: string,
    ref: string,
  ): Promise<readonly ManualWorkflowOnGitHub[]> {
    const { repository, token } = await this.reading(remoteUrl);
    return this.api.workflowsOf(token, repository, ref).catch(failedAccess);
  }

  /** The remote's repository's branches and tags, at most 1,000 of each. Throws as `openPullRequests` does. */
  async refs(remoteUrl: string): Promise<RefsOfRepositoryOnGitHub> {
    const { repository, token } = await this.reading(remoteUrl);
    return this.api.refsOf(token, repository).catch(failedAccess);
  }

  /**
   * Starts workflow `file` of the remote's repository on `ref` with the inputs; the run it queues
   * shows in the next `recentRuns`. Throws `NotSignedInWithGitHub` while signed out and
   * `GitHubAccessFailed`, in GitHub's words, when GitHub refuses (such as an input the file doesn't
   * declare, or without the App's Actions permission) or fails.
   */
  async startWorkflow(remoteUrl: string, start: WorkflowStartOnGitHub): Promise<void> {
    const { repository, token } = await this.reading(remoteUrl);
    await this.api.dispatchWorkflow(token, repository, start).catch(failedAccess);
  }

  /**
   * The merge methods the remote's repository allows (all three where GitHub doesn't say) and
   * whether GitHub deletes a branch once merged. Throws as `openPullRequests` does.
   */
  async mergeMethods(remoteUrl: string): Promise<MergeMethodsOnGitHub> {
    const { repository, token } = await this.reading(remoteUrl);
    const settings = await this.api.repositoryOf(token, repository).catch(failedAccess);
    return {
      allowed: allowedMergeMethodsOf(settings),
      deletesBranchOnMerge: settings.deleteBranchOnMerge,
    };
  }

  /**
   * Merges pull request `number` by `method`, as long as its head is still `expectedHeadCommit`;
   * a squash's commit is titled "<title> (#n)" with the pull request's body as its message. Its
   * branch stays. Throws `PullRequestChangedOnGitHub` when the head moved, `PullRequestNotChanged`
   * when GitHub refuses or can't be reached, and as `openPullRequests` does otherwise.
   */
  async merge(
    remoteUrl: string,
    number: number,
    { method, expectedHeadCommit }: MergeOnGitHub,
  ): Promise<MergedOnGitHub> {
    const { repository, token } = await this.reading(remoteUrl);
    let squashed: { commitTitle: string; commitMessage: string } | undefined;
    if (method === "squash") {
      const pullRequest = await this.api
        .pullRequestOf(token, repository, number)
        .catch(failedAccess);
      squashed = {
        commitTitle: `${pullRequest.title} (#${number})`,
        commitMessage: pullRequest.body,
      };
    }
    const answer = await this.api
      .mergePullRequest(token, repository, number, {
        method,
        sha: expectedHeadCommit,
        ...squashed,
      })
      .catch(unreachable);
    if (answer.kind === "refused") throw mergeRefusal(answer, repository, number);
    return { commit: answer.sha };
  }

  /**
   * Closes pull request `number` without merging it; its branch stays. Throws
   * `PullRequestNotChanged` when GitHub refuses or can't be reached, and as `openPullRequests` does
   * otherwise.
   */
  async close(remoteUrl: string, number: number): Promise<void> {
    const { repository, token } = await this.reading(remoteUrl);
    const refusal = await this.api.closePullRequest(token, repository, number).catch(unreachable);
    if (refusal !== undefined) throw closeRefusal(refusal, repository, number);
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

/** A merge or close GitHub got no answer to, in the user's words; other failures as `failedAccess`. */
function unreachable(error: unknown): never {
  if (error instanceof GitHubUnreachable) throw new PullRequestNotChanged(GITHUB_UNREACHABLE);
  return failedAccess(error);
}
