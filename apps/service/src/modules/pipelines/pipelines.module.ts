import { Module, type DynamicModule, type ModuleMetadata, type Type } from "@nestjs/common";
import { PostgresStageRunRepository } from "./adapters/postgres/postgres-stage-run-repository.js";
import { PostgresTaskStagesRepository } from "./adapters/postgres/postgres-task-stages-repository.js";
import { StageInterpreter } from "./application/stage-interpreter.js";
import { StageRunners } from "./application/stage-runners.js";
import { TaskStagesService } from "./application/task-stages-service.js";
import { PipelineLibraryModule } from "./pipeline-library.module.js";
import { StageRunRepository } from "./ports/stage-run-repository.js";
import { StartedTasks } from "./ports/started-tasks.js";
import { TaskStagesRepository } from "./ports/task-stages-repository.js";

export interface PipelinesModuleOptions {
  /** The module that provides the port below: Work. */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
  readonly startedTasks: Type<StartedTasks>;
}

/** Pipelines whole: the library, each started Task's own Stages, and the Stage interpreter. */
@Module({})
export class PipelinesModule {
  static register({ imports, startedTasks }: PipelinesModuleOptions): DynamicModule {
    return {
      module: PipelinesModule,
      imports: [PipelineLibraryModule, ...imports],
      providers: [
        { provide: TaskStagesRepository, useClass: PostgresTaskStagesRepository },
        { provide: StageRunRepository, useClass: PostgresStageRunRepository },
        { provide: StartedTasks, useExisting: startedTasks },
        TaskStagesService,
        StageRunners,
        StageInterpreter,
      ],
      exports: [PipelineLibraryModule, TaskStagesService],
    };
  }
}
