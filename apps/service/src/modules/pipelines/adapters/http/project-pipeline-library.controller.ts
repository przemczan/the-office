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
  UseFilters,
} from "@nestjs/common";
import {
  newProjectPipelineSchema,
  projectPipelineCheckRequestSchema,
  projectPipelineEditSchema,
  type NewProjectPipeline,
  type PipelineUse,
  type ProjectPipeline as ProjectPipelineResponse,
  type ProjectPipelineCheck,
  type ProjectPipelineCheckRequest,
  type ProjectPipelineEdit,
} from "@the-office/contracts";
import { ContractPipe } from "../../../../platform/http/contract-pipe.js";
import { PipelineLibraryEditor } from "../../application/pipeline-library-editor.js";
import { PipelineLibraryRefusalsFilter } from "./pipeline-library-refusals.filter.js";
import {
  toBuiltStagesResponse,
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

  /** What saving the edit would be refused for, what it would only flag, and its built Stages. */
  @Post("check")
  @HttpCode(HttpStatus.OK)
  async check(
    @Body(new ContractPipe(projectPipelineCheckRequestSchema))
    { projectId, projectPipelineId, ...edit }: ProjectPipelineCheckRequest,
  ): Promise<ProjectPipelineCheck> {
    const { problems, flags, built } = await this.editor.checkProjectPipeline(edit, {
      projectId,
      projectPipelineId,
    });
    return {
      problems: [...problems, ...flags].map(toStageProblemResponse),
      ...toBuiltStagesResponse(built ?? { rows: [], stages: [], broken: [] }),
    };
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
