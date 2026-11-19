import { Controller, Get, HttpCode, HttpStatus, Logger, Post, Query } from "@nestjs/common";
import {
  pullRequestListQuerySchema,
  type PullRequest as PullRequestResponse,
  type PullRequestList as PullRequestListResponse,
  type PullRequestProblem as PullRequestProblemResponse,
  type PullRequestListQuery,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { PullRequestWatch, type PullRequestProblem } from "../../application/pull-request-watch.js";
import type { PullRequest } from "../../domain/pull-request.js";

/** Work › Pull requests: the open pull requests The Office opened, with their checks and merge state. */
@Controller("pull-requests")
export class PullRequestsController {
  private readonly logger = new Logger(PullRequestsController.name);

  constructor(private readonly watch: PullRequestWatch) {}

  @Get()
  async list(
    @Query(new ContractPipe(pullRequestListQuerySchema)) { projectId }: PullRequestListQuery,
  ): Promise<PullRequestListResponse> {
    const { pullRequests, problems } = await this.watch.list(projectId);
    return {
      pullRequests: pullRequests.map(toPullRequestResponse),
      problems: problems.map(toProblemResponse),
    };
  }

  /** Answers at once; what the refresh changes reaches the web as `pull-requests.changed`. */
  @Post("refresh")
  @HttpCode(HttpStatus.ACCEPTED)
  refresh(): void {
    this.watch.refresh().catch((error: unknown) => {
      this.logger.warn(
        `Refreshing the pull requests failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }
}

function toPullRequestResponse(pullRequest: PullRequest): PullRequestResponse {
  return {
    id: pullRequest.id,
    projectId: pullRequest.projectId,
    taskId: pullRequest.taskId,
    number: pullRequest.number,
    url: pullRequest.url,
    title: pullRequest.title,
    branch: pullRequest.branch,
    baseBranch: pullRequest.baseBranch,
    openedAt: pullRequest.openedAt.toISOString(),
    checks: pullRequest.checks,
    mergeable: pullRequest.mergeable,
    checkedAt: pullRequest.checkedAt?.toISOString() ?? null,
    stale: pullRequest.stale,
  };
}

function toProblemResponse(problem: PullRequestProblem): PullRequestProblemResponse {
  if (problem.kind === "cannot-read") return { ...problem };
  return {
    kind: "unreachable",
    projectId: problem.projectId,
    codeHost: problem.codeHost,
    failedAt: problem.failedAt.toISOString(),
    lastReadAt: problem.lastReadAt?.toISOString() ?? null,
  };
}
