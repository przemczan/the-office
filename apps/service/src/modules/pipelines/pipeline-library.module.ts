import { Module } from "@nestjs/common";
import { PipelinesController } from "./adapters/http/pipelines.controller.js";
import { PostgresPipelineRepository } from "./adapters/postgres/postgres-pipeline-repository.js";
import { PipelineLibrary } from "./application/pipeline-library.js";
import { PipelineRepository } from "./ports/pipeline-repository.js";

/**
 * The library alone, for the modules that read Pipelines: the rest of Pipelines calls Work and
 * Projects, so they and the others must not import PipelinesModule. The library editor, which asks
 * them who uses a Pipeline, lives in PipelinesModule and writes through the repository exported here.
 */
@Module({
  controllers: [PipelinesController],
  providers: [
    { provide: PipelineRepository, useClass: PostgresPipelineRepository },
    PipelineLibrary,
  ],
  exports: [PipelineLibrary, PipelineRepository],
})
export class PipelineLibraryModule {}
