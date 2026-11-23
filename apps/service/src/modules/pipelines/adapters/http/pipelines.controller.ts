import { Controller, Get, NotFoundException, Param } from "@nestjs/common";
import type { OfficeWidePipeline as OfficeWidePipelineResponse } from "@the-office/contracts";
import { PipelineLibrary } from "../../application/pipeline-library.js";
import { toPipelineResponse } from "./pipeline-responses.js";

/** The office-wide Pipelines; a Project's own are `ProjectPipelinesController`'s. */
@Controller("pipelines")
export class PipelinesController {
  constructor(private readonly library: PipelineLibrary) {}

  @Get()
  async list(): Promise<OfficeWidePipelineResponse[]> {
    return (await this.library.list()).map(toPipelineResponse);
  }

  @Get(":id")
  async read(@Param("id") id: string): Promise<OfficeWidePipelineResponse> {
    const pipeline = await this.library.find(id);
    if (!pipeline) throw new NotFoundException(`There is no Pipeline "${id}".`);
    return toPipelineResponse(pipeline);
  }
}
