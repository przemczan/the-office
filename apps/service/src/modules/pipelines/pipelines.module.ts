import { Module } from "@nestjs/common";
import { PostgresTaskStagesRepository } from "./adapters/postgres/postgres-task-stages-repository.js";
import { TaskStagesService } from "./application/task-stages-service.js";
import { PipelineLibraryModule } from "./pipeline-library.module.js";
import { TaskStagesRepository } from "./ports/task-stages-repository.js";

/** Pipelines whole: the library, and each started Task's own Stages. */
@Module({
  imports: [PipelineLibraryModule],
  providers: [
    { provide: TaskStagesRepository, useClass: PostgresTaskStagesRepository },
    TaskStagesService,
  ],
  exports: [PipelineLibraryModule, TaskStagesService],
})
export class PipelinesModule {}
