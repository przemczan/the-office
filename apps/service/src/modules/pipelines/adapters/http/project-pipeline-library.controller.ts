import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseFilters,
} from "@nestjs/common";
import {
  projectPipelineCheckRequestSchema,
  type PipelineUse,
  type PipelinesNeedingFixing,
  type ProjectPipelineCheck,
  type ProjectPipelineCheckRequest,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { withStagesGiven } from "./given-stages.js";
import { PipelineLibraryEditor } from "../../application/pipeline-library-editor.js";
import { PipelineLibraryRefusalsFilter } from "./pipeline-library-refusals.filter.js";
import { toPipelineUseResponse, toStageProblemResponse } from "./pipeline-responses.js";
import { StagesEditRefusalsFilter } from "./stages-edit-refusals.filter.js";

/**
 * The Project Pipelines' checks and use; their changes are Pipelines' Office actions. Reading them
 * is `ProjectPipelinesController`'s, in the library's own module; these ask Projects and Work who
 * uses one, so they live with the rest of Pipelines.
 */
@Controller("project-pipelines")
@UseFilters(StagesEditRefusalsFilter, PipelineLibraryRefusalsFilter)
export class ProjectPipelineLibraryController {
  constructor(private readonly editor: PipelineLibraryEditor) {}

  /** What saving the edit would be refused for and what it would only flag; it saves nothing. */
  @Post("check")
  @HttpCode(HttpStatus.OK)
  async check(
    @Body(new ContractPipe(projectPipelineCheckRequestSchema))
    { projectPipelineId, ...edit }: ProjectPipelineCheckRequest,
  ): Promise<ProjectPipelineCheck> {
    const { problems, flags } = await this.editor.checkProjectPipeline(
      projectPipelineId,
      withStagesGiven(edit),
    );
    return { problems: [...problems, ...flags].map(toStageProblemResponse) };
  }

  /** The Project's own Pipelines flagged "Needs fixing", checked in one go. */
  @Get("check/needs-fixing")
  async needingFixing(@Query("projectId") projectId: string): Promise<PipelinesNeedingFixing> {
    return { pipelineIds: await this.editor.projectPipelinesNeedingFixing(projectId) };
  }

  @Get(":id/use")
  async use(@Param("id") id: string): Promise<PipelineUse> {
    return toPipelineUseResponse(await this.editor.projectPipelineUse(id));
  }
}
