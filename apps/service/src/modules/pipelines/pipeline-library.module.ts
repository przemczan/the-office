import { Module } from "@nestjs/common";
import { PipelinesController } from "./adapters/http/pipelines.controller.js";
import { ProjectPipelinesController } from "./adapters/http/project-pipelines.controller.js";
import { StageTemplatesController } from "./adapters/http/stage-templates.controller.js";
import { PostgresPipelineRepository } from "./adapters/postgres/postgres-pipeline-repository.js";
import { PostgresProjectPipelineRepository } from "./adapters/postgres/postgres-project-pipeline-repository.js";
import { PostgresStageTemplateRepository } from "./adapters/postgres/postgres-stage-template-repository.js";
import { PipelineLibrary } from "./application/pipeline-library.js";
import { StageTemplateLibrary } from "./application/stage-template-library.js";
import { PipelineRepository } from "./ports/pipeline-repository.js";
import { ProjectPipelineRepository } from "./ports/project-pipeline-repository.js";
import { StageTemplateRepository } from "./ports/stage-template-repository.js";

/**
 * The library alone, its office-wide Pipelines and Stage templates, with the Project Pipelines
 * beside it, for the modules that read them: the rest of Pipelines calls Work and Projects, so they
 * and the others must not import PipelinesModule. The editors, the Pipelines' asking them who uses
 * a Pipeline, live in PipelinesModule and write through the repositories exported here.
 */
@Module({
  controllers: [PipelinesController, ProjectPipelinesController, StageTemplatesController],
  providers: [
    { provide: PipelineRepository, useClass: PostgresPipelineRepository },
    { provide: ProjectPipelineRepository, useClass: PostgresProjectPipelineRepository },
    { provide: StageTemplateRepository, useClass: PostgresStageTemplateRepository },
    PipelineLibrary,
    StageTemplateLibrary,
  ],
  exports: [
    PipelineLibrary,
    PipelineRepository,
    ProjectPipelineRepository,
    StageTemplateLibrary,
    StageTemplateRepository,
  ],
})
export class PipelineLibraryModule {}
