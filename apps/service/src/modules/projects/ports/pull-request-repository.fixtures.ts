import type { PullRequest } from "../domain/pull-request.js";
import { PullRequestRepository } from "./pull-request-repository.js";

/** The pull requests kept in memory, failing every call while a test sets `failure`. */
export class PullRequestRepositoryForTests extends PullRequestRepository {
  readonly kept = new Map<string, PullRequest>();
  failure: Error | undefined = undefined;

  async record(pullRequest: PullRequest): Promise<PullRequest> {
    this.failIfAsked();
    const known = await this.find(pullRequest.remoteUrl, pullRequest.number);
    const kept: PullRequest = known
      ? {
          ...known,
          projectId: pullRequest.projectId,
          taskId: pullRequest.taskId,
          url: pullRequest.url,
          title: pullRequest.title,
          branch: pullRequest.branch,
          baseBranch: pullRequest.baseBranch,
          state: "open",
          endedAt: null,
        }
      : pullRequest;
    this.kept.set(kept.id, kept);
    return kept;
  }

  async save(pullRequest: PullRequest): Promise<void> {
    this.failIfAsked();
    this.kept.set(pullRequest.id, pullRequest);
  }

  async listOpen(projectId?: string): Promise<readonly PullRequest[]> {
    this.failIfAsked();
    return [...this.kept.values()]
      .filter((one) => one.endedAt === null)
      .filter((one) => projectId === undefined || one.projectId === projectId)
      .toSorted((one, other) => other.openedAt.getTime() - one.openedAt.getTime());
  }

  async find(remoteUrl: string, number: number): Promise<PullRequest | undefined> {
    this.failIfAsked();
    return [...this.kept.values()].find(
      (one) => one.remoteUrl === remoteUrl && one.number === number,
    );
  }

  private failIfAsked(): void {
    if (this.failure) throw this.failure;
  }
}
