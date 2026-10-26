import { Module } from "@nestjs/common";
import { PipelinesController } from "./adapters/http/pipelines.controller.js";
import { PipelineLibrary } from "./application/pipeline-library.js";

/**
 * The library alone, for the modules that read Pipelines: the rest of Pipelines will call Work,
 * so Work and the others must not import PipelinesModule.
 */
@Module({
  controllers: [PipelinesController],
  providers: [PipelineLibrary],
  exports: [PipelineLibrary],
})
export class PipelineLibraryModule {}
