import { Module } from "@nestjs/common";
import { PipelinesController } from "./adapters/http/pipelines.controller.js";
import { PipelineLibrary } from "./application/pipeline-library.js";

@Module({
  controllers: [PipelinesController],
  providers: [PipelineLibrary],
  exports: [PipelineLibrary],
})
export class PipelinesModule {}
