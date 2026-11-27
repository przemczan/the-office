import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseFilters,
} from "@nestjs/common";
import {
  pullRequestListQuerySchema,
  pullRequestMergeSchema,
  type PullRequestMerge,
  type PullRequestMergeMethods,
  type PullRequest as PullRequestResponse,
  type PullRequestList as PullRequestListResponse,
  type PullRequestProblem as PullRequestProblemResponse,
  type PullRequestListQuery,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { SignedIn, userOf } from "../../../../platform/http/signed-in-requests.js";
import { PullRequestActions } from "../../application/pull-request-actions.js";
import { PullRequestWatch, type PullRequestProblem } from "../../application/pull-request-watch.js";
import type { PullRequest } from "../../domain/pull-request.js";
import { PullRequestRefusalsFilter } from "./pull-request-refusals.filter.js";

/**
 * Work › Pull requests: the open pull requests The Office opened, with their checks and merge
 * state, and their Merge and Close (Close is the Office action close_pull_request). A refused
 * merge or close answers 409 `{ reason, refresh }`.
 */
@Controller("pull-requests")
@UseFilters(PullRequestRefusalsFilter)
export class PullRequestsController {
  private readonly logger = new Logger(PullRequestsController.name);

  constructor(
    private readonly watch: PullRequestWatch,
    private readonly actions: PullRequestActions,
  ) {}

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

  /** What the Merge dialog offers: the methods the repository allows and the one picked first. */
  @Get(":id/merge-methods")
  async mergeMethods(@Param("id", ParseUUIDPipe) id: string): Promise<PullRequestMergeMethods> {
    const offer = await this.actions.mergeMethods(id);
    return {
      allowed: [...offer.allowed],
      recommended: offer.recommended,
      warning: offer.warning ?? null,
      deletesBranchOnMerge: offer.deletesBranchOnMerge ?? null,
    };
  }

  @Post(":id/merge")
  @HttpCode(HttpStatus.NO_CONTENT)
  async merge(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ContractPipe(pullRequestMergeSchema)) { method }: PullRequestMerge,
    @SignedIn() signedIn: SignedIn,
  ): Promise<void> {
    await this.actions.merge(id, method, userOf(signedIn));
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
