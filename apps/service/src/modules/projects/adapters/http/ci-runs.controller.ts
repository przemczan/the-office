import { Controller, Get, HttpCode, HttpStatus, Logger, Post, Query } from "@nestjs/common";
import {
  ciRunListQuerySchema,
  type CiRun as CiRunResponse,
  type CiRunList as CiRunListResponse,
  type CiRunListing as CiRunListingResponse,
  type CiRunListQuery,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { CiRunWatch, type CiRun, type CiRunListing } from "../../application/ci-run-watch.js";

/** Work › CI: each Project's recent CI runs on its code host, and where each listing stands. */
@Controller("ci-runs")
export class CiRunsController {
  private readonly logger = new Logger(CiRunsController.name);

  constructor(private readonly watch: CiRunWatch) {}

  @Get()
  list(
    @Query(new ContractPipe(ciRunListQuerySchema)) { projectId }: CiRunListQuery,
  ): CiRunListResponse {
    const { runs, projects } = this.watch.list(projectId);
    return { runs: runs.map(toCiRunResponse), projects: projects.map(toListingResponse) };
  }

  /**
   * Answers at once; what the refresh changes reaches the web as `ci-runs.changed`. The Project's
   * runs only when `projectId` names one.
   */
  @Post("refresh")
  @HttpCode(HttpStatus.ACCEPTED)
  refresh(@Query(new ContractPipe(ciRunListQuerySchema)) { projectId }: CiRunListQuery): void {
    this.watch.refresh(projectId).catch((error: unknown) => {
      this.logger.warn(
        `Refreshing the CI runs failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }
}

function toCiRunResponse(run: CiRun): CiRunResponse {
  return {
    id: run.id,
    projectId: run.projectId,
    number: run.number,
    attempt: run.attempt,
    workflow: run.workflow,
    title: run.title,
    trigger: run.trigger,
    branch: run.branch,
    commit: run.commit,
    status: run.status,
    startedAt: run.startedAt?.toISOString() ?? null,
    updatedAt: run.updatedAt.toISOString(),
    url: run.url,
    taskId: run.taskId,
  };
}

function toListingResponse(listing: CiRunListing): CiRunListingResponse {
  const { problem } = listing;
  return {
    projectId: listing.projectId,
    checkedAt: listing.checkedAt?.toISOString() ?? null,
    stale: listing.stale,
    problem:
      problem === null || problem.kind === "cannot-read"
        ? problem
        : {
            kind: "unreachable",
            codeHost: problem.codeHost,
            failedAt: problem.failedAt.toISOString(),
          },
  };
}
