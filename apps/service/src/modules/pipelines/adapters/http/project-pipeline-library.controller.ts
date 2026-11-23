import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseFilters,
} from "@nestjs/common";
import {
  newProjectPipelineSchema,
  projectPipelineCheckRequestSchema,
  projectPipelineEditSchema,
  type NewProjectPipeline,
  type PipelineUse,
  type PipelinesNeedingFixing,
  type ProjectPipeline as ProjectPipelineResponse,
  type ProjectPipelineCheck,
  type ProjectPipelineCheckRequest,
  type ProjectPipelineEdit,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { PipelineLibraryEditor } from "../../application/pipeline-library-editor.js";
import { PipelineLibraryRefusalsFilter } from "./pipeline-library-refusals.filter.js";
import {
  toPipelineUseResponse,
  toProjectPipelineResponse,
  toStageProblemResponse,
} from "./pipeline-responses.js";
import { StagesEditRefusalsFilter } from "./stages-edit-refusals.filter.js";

/**
 * The Project Pipelines' changes. Reading them is `ProjectPipelinesController`'s, in the library's
 * own module; these ask Projects and Work who uses one, so they live with the rest of Pipelines.
 */
@Controller("project-pipelines")
@UseFilters(StagesEditRefusalsFilter, PipelineLibraryRefusalsFilter)
export class ProjectPipelineLibraryController {
  constructor(private readonly editor: PipelineLibraryEditor) {}

  @Post()
  async add(
    @Body(new ContractPipe(newProjectPipelineSchema)) { projectId, ...edit }: NewProjectPipeline,
  ): Promise<ProjectPipelineResponse> {
    return toProjectPipelineResponse(await this.editor.addProjectPipeline(projectId, edit));
  }

  /** What saving the edit would be refused for and what it would only flag; it saves nothing. */
  @Post("check")
  @HttpCode(HttpStatus.OK)
  async check(
    @Body(new ContractPipe(projectPipelineCheckRequestSchema))
    { projectPipelineId, ...edit }: ProjectPipelineCheckRequest,
  ): Promise<ProjectPipelineCheck> {
    const { problems, flags } = await this.editor.checkProjectPipeline(projectPipelineId, edit);
    return { problems: [...problems, ...flags].map(toStageProblemResponse) };
  }

  /** The Project's own Pipelines flagged "Needs fixing", checked in one go. */
  @Get("check/needs-fixing")
  async needingFixing(@Query("projectId") projectId: string): Promise<PipelinesNeedingFixing> {
    return { pipelineIds: await this.editor.projectPipelinesNeedingFixing(projectId) };
  }

  /** Saves the edit; the Project Pipeline's Project stays. */
  @Put(":id")
  async save(
    @Param("id") id: string,
    @Body(new ContractPipe(projectPipelineEditSchema)) edit: ProjectPipelineEdit,
  ): Promise<ProjectPipelineResponse> {
    return toProjectPipelineResponse(await this.editor.saveProjectPipeline(id, edit));
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param("id") id: string): Promise<void> {
    await this.editor.removeProjectPipeline(id);
  }

  @Get(":id/use")
  async use(@Param("id") id: string): Promise<PipelineUse> {
    return toPipelineUseResponse(await this.editor.projectPipelineUse(id));
  }
}
