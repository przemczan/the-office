import { Injectable } from "@nestjs/common";
import type { PullRequest } from "../domain/pull-request.js";
import { PullRequestRepository } from "../ports/pull-request-repository.js";

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
}
