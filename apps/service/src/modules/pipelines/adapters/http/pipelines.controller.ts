import { Controller, Get, NotFoundException, Param } from "@nestjs/common";
import type { Pipeline as PipelineResponse } from "@the-office/contracts";
import { PipelineLibrary } from "../../application/pipeline-library.js";
import { toPipelineResponse } from "./pipeline-responses.js";

@Controller("pipelines")
export class PipelinesController {
  constructor(private readonly library: PipelineLibrary) {}

  @Get()
  async list(): Promise<PipelineResponse[]> {
    return (await this.library.list()).map(toPipelineResponse);
  }

  @Get(":id")
  async read(@Param("id") id: string): Promise<PipelineResponse> {
    const pipeline = await this.library.find(id);
    if (!pipeline) throw new NotFoundException(`There is no Pipeline "${id}".`);
    return toPipelineResponse(pipeline);
  }
}
