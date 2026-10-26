import { Module, type DynamicModule, type ModuleMetadata, type Type } from "@nestjs/common";
import { PostgresStageRunRepository } from "./adapters/postgres/postgres-stage-run-repository.js";
import { NoTaskDiffsYet } from "./adapters/projects/no-task-diffs-yet.js";
import { PostgresTaskStagesRepository } from "./adapters/postgres/postgres-task-stages-repository.js";
import { AgentStageRunner } from "./application/agent-stage-runner.js";
import { StageInterpreter } from "./application/stage-interpreter.js";
import { StageRunners } from "./application/stage-runners.js";
import { TaskStagesService } from "./application/task-stages-service.js";
import { PipelineLibraryModule } from "./pipeline-library.module.js";
import { KnownPeople } from "./ports/known-people.js";
import { StageRunRepository } from "./ports/stage-run-repository.js";
import { StageThreads } from "./ports/stage-threads.js";
import { StartedTasks } from "./ports/started-tasks.js";
import { TaskDiffs } from "./ports/task-diffs.js";
import { TaskRecords } from "./ports/task-records.js";
import { TaskStagesRepository } from "./ports/task-stages-repository.js";

export interface PipelinesModuleOptions {
  /** The modules that provide the ports below: Work, People and Conversations. */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
  readonly startedTasks: Type<StartedTasks>;
  readonly taskRecords: Type<TaskRecords>;
  readonly knownPeople: Type<KnownPeople>;
  readonly stageThreads: Type<StageThreads>;
}

/** Pipelines whole: the library, each started Task's own Stages, and the Stage interpreter. */
@Module({})
export class PipelinesModule {
  static register({
    imports,
    startedTasks,
    taskRecords,
    knownPeople,
    stageThreads,
  }: PipelinesModuleOptions): DynamicModule {
    return {
      module: PipelinesModule,
      imports: [PipelineLibraryModule, ...imports],
      providers: [
        { provide: TaskStagesRepository, useClass: PostgresTaskStagesRepository },
        { provide: StageRunRepository, useClass: PostgresStageRunRepository },
        { provide: StartedTasks, useExisting: startedTasks },
        { provide: TaskRecords, useExisting: taskRecords },
        { provide: KnownPeople, useExisting: knownPeople },
        { provide: StageThreads, useExisting: stageThreads },
        { provide: TaskDiffs, useClass: NoTaskDiffsYet },
        TaskStagesService,
        StageRunners,
        StageInterpreter,
        AgentStageRunner,
      ],
      exports: [PipelineLibraryModule, TaskStagesService],
    };
  }
}
