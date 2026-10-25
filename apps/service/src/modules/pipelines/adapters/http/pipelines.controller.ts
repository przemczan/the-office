import { Controller, Get, NotFoundException, Param } from "@nestjs/common";
import type { Pipeline as PipelineResponse, Stage as StageResponse } from "@the-office/contracts";
import { PipelineLibrary } from "../../application/pipeline-library.js";
import type { Pipeline } from "../../domain/pipeline.js";
import type { Stage } from "../../domain/stage.js";

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

function toPipelineResponse(pipeline: Pipeline): PipelineResponse {
  return {
    id: pipeline.id,
    name: pipeline.name,
    description: pipeline.description,
    stages: pipeline.stages.map(toStageResponse),
  };
}

function toStageResponse(stage: Stage): StageResponse {
  const fields = { key: stage.key, name: stage.name, optional: stage.optional };
  switch (stage.kind) {
    case "agent":
      return {
        kind: "agent",
        ...fields,
        role: stage.role,
        brief: stage.brief,
        session: stage.session,
        budget: stage.budget,
        onFailure: stage.onFailure,
      };
    case "script":
      return { kind: "script", ...fields, command: stage.command, onFailure: stage.onFailure };
    case "gate":
      return { kind: "gate", ...fields };
  }
}
