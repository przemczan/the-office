import { Injectable } from "@nestjs/common";
import type { PullRequest } from "../domain/pull-request.js";
import { PullRequestRepository } from "../ports/pull-request-repository.js";

/** An open pull request whose checks fail or which has conflicts, as last read. */
export interface PullRequestNeedingAttention {
  readonly id: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly number: number;
  readonly url: string;
  readonly checksFailing: boolean;
  readonly conflicts: boolean;
  /** When its status was last read, or when it was opened before the first read. */
  readonly waitingSince: Date;
}

/** The pull requests The Office opened, as other modules read them by the Task that opened them. */
@Injectable()
export class PullRequestRecords {
  constructor(private readonly pullRequests: PullRequestRepository) {}

  /** The Task's open pull request, as last read; undefined when it has none open. */
  async openOf(taskId: string): Promise<PullRequest | undefined> {
    return (await this.pullRequests.listOpen()).find(
      (pullRequest) => pullRequest.taskId === taskId,
    );
  }

  /** The Project's open pull request from `branch`, as last read; undefined when none is open. */
  async openFromBranch(projectId: string, branch: string): Promise<PullRequest | undefined> {
    return (await this.pullRequests.listOpen(projectId)).find(
      (pullRequest) => pullRequest.branch === branch,
    );
  }

  /** Whether the newest pull request the Task opened is recorded merged. */
  async isMerged(taskId: string): Promise<boolean> {
    return (await this.pullRequests.ofTask(taskId))?.state === "merged";
  }

  /** The open pull requests whose checks fail or which have conflicts, as last read, oldest first. */
  async needingAttention(): Promise<readonly PullRequestNeedingAttention[]> {
    return (await this.pullRequests.listOpen())
      .filter(({ checks, mergeable }) => checks === "failing" || mergeable === "conflicts")
      .map((pullRequest) => ({
        id: pullRequest.id,
        projectId: pullRequest.projectId,
        taskId: pullRequest.taskId,
        number: pullRequest.number,
        url: pullRequest.url,
        checksFailing: pullRequest.checks === "failing",
        conflicts: pullRequest.mergeable === "conflicts",
        waitingSince: pullRequest.checkedAt ?? pullRequest.openedAt,
      }))
      .toSorted((one, other) => one.waitingSince.getTime() - other.waitingSince.getTime());
  }
}
