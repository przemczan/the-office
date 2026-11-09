import { Module } from "@nestjs/common";
import { PipelinesController } from "./adapters/http/pipelines.controller.js";
import { StageTemplatesController } from "./adapters/http/stage-templates.controller.js";
import { PostgresPipelineRepository } from "./adapters/postgres/postgres-pipeline-repository.js";
import { PostgresStageTemplateRepository } from "./adapters/postgres/postgres-stage-template-repository.js";
import { PipelineLibrary } from "./application/pipeline-library.js";
import { StageTemplateLibrary } from "./application/stage-template-library.js";
import { PipelineRepository } from "./ports/pipeline-repository.js";
import { StageTemplateRepository } from "./ports/stage-template-repository.js";

/**
 * The library alone, its Pipelines and Stage templates, for the modules that read it: the rest of Pipelines calls Work and
 * Projects, so they and the others must not import PipelinesModule. The library editor, which asks
 * them who uses a Pipeline, lives in PipelinesModule and writes through the repository exported here.
 */
@Module({
  controllers: [PipelinesController, StageTemplatesController],
  providers: [
    { provide: PipelineRepository, useClass: PostgresPipelineRepository },
    { provide: StageTemplateRepository, useClass: PostgresStageTemplateRepository },
    PipelineLibrary,
    StageTemplateLibrary,
  ],
  exports: [PipelineLibrary, PipelineRepository, StageTemplateLibrary, StageTemplateRepository],
})
export class PipelineLibraryModule {}
