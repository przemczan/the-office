import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  UseFilters,
} from "@nestjs/common";
import {
  ciRunListQuerySchema,
  manualWorkflowListQuerySchema,
  type ManualWorkflowList as ManualWorkflowListResponse,
  type ManualWorkflowListQuery,
  type RefList as RefListResponse,
  type CiRun as CiRunResponse,
  type CiRunList as CiRunListResponse,
  type CiRunListing as CiRunListingResponse,
  type CiRunListQuery,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { CiRunWatch, type CiRun, type CiRunListing } from "../../application/ci-run-watch.js";
import { ManualWorkflows } from "../../application/manual-workflows.js";
import { ProjectRefusalsFilter } from "./project-refusals.filter.js";

/**
 * Work › CI: each Project's recent CI runs on its code host, and where each listing stands; and
 * what a start by hand offers, the Workflows that declare it on a ref and the branches and tags,
 * answered empty with the problem in plain words when the code host can't be read.
 */
@Controller()
@UseFilters(ProjectRefusalsFilter)
export class CiRunsController {
  private readonly logger = new Logger(CiRunsController.name);

  constructor(
    private readonly watch: CiRunWatch,
    private readonly manualWorkflows: ManualWorkflows,
  ) {}

  @Get("ci-runs")
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
  @Post("ci-runs/refresh")
  @HttpCode(HttpStatus.ACCEPTED)
  refresh(@Query(new ContractPipe(ciRunListQuerySchema)) { projectId }: CiRunListQuery): void {
    this.watch.refresh(projectId).catch((error: unknown) => {
      this.logger.warn(
        `Refreshing the CI runs failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  /** The ref used is answered, the Project's base branch when the query leaves it out. */
  @Get("projects/:projectId/workflows")
  async workflows(
    @Param("projectId") projectId: string,
    @Query(new ContractPipe(manualWorkflowListQuerySchema)) { ref }: ManualWorkflowListQuery,
  ): Promise<ManualWorkflowListResponse> {
    const { workflows, ...listed } = await this.manualWorkflows.list(projectId, ref);
    return {
      ...listed,
      workflows: workflows.map(({ inputs, ...workflow }) => ({
        ...workflow,
        inputs: inputs.map((input) => ({ ...input, options: [...input.options] })),
      })),
    };
  }

  @Get("projects/:projectId/refs")
  async refs(@Param("projectId") projectId: string): Promise<RefListResponse> {
    const { branches, tags, ...listed } = await this.manualWorkflows.refs(projectId);
    return { ...listed, branches: [...branches], tags: [...tags] };
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
