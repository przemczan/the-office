import { Controller, Get, NotFoundException, Param, Query } from "@nestjs/common";
import type { ProjectPipeline as ProjectPipelineResponse } from "@the-office/contracts";
import { PipelineLibrary } from "../../application/pipeline-library.js";
import { toProjectPipelineResponse } from "./pipeline-responses.js";

/**
 * Reading the Project Pipelines, each built from its base Pipeline's current Stages. Their changes
 * are `ProjectPipelineLibraryController`'s, with the rest of Pipelines.
 */
@Controller("project-pipelines")
export class ProjectPipelinesController {
  constructor(private readonly library: PipelineLibrary) {}

  /** The Project's Project Pipelines; every Project's without `projectId`. */
  @Get()
  async list(@Query("projectId") projectId?: string): Promise<ProjectPipelineResponse[]> {
    const projectPipelines = await this.library.projectPipelines(projectId || undefined);
    return projectPipelines.map(toProjectPipelineResponse);
  }

  @Get(":id")
  async read(@Param("id") id: string): Promise<ProjectPipelineResponse> {
    const projectPipeline = await this.library.projectPipeline(id);
    if (!projectPipeline) throw new NotFoundException(`There is no Project Pipeline "${id}".`);
    return toProjectPipelineResponse(projectPipeline);
  }
}
