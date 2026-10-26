import { Module, type DynamicModule, type ModuleMetadata, type Type } from "@nestjs/common";
import { PostgresStageRunRepository } from "./adapters/postgres/postgres-stage-run-repository.js";
import { PostgresTaskStagesRepository } from "./adapters/postgres/postgres-task-stages-repository.js";
import { AgentStageRunner } from "./application/agent-stage-runner.js";
import { ScriptStageRunner } from "./application/script-stage-runner.js";
import { StageGit } from "./application/stage-git.js";
import { StageInterpreter } from "./application/stage-interpreter.js";
import { StageRunners } from "./application/stage-runners.js";
import { TaskStagesService } from "./application/task-stages-service.js";
import { PipelineLibraryModule } from "./pipeline-library.module.js";
import { KnownPeople } from "./ports/known-people.js";
import { StageRunRepository } from "./ports/stage-run-repository.js";
import { StageThreads } from "./ports/stage-threads.js";
import { StartedTasks } from "./ports/started-tasks.js";
import { TaskCommands } from "./ports/task-commands.js";
import { TaskGit } from "./ports/task-git.js";
import { TaskRecords } from "./ports/task-records.js";
import { TaskStagesRepository } from "./ports/task-stages-repository.js";

export interface PipelinesModuleOptions {
  /** The modules that provide the ports below: Work, People, Conversations and Projects. */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
  readonly startedTasks: Type<StartedTasks>;
  readonly taskRecords: Type<TaskRecords>;
  readonly knownPeople: Type<KnownPeople>;
  readonly stageThreads: Type<StageThreads>;
  readonly taskGit: Type<TaskGit>;
  readonly taskCommands: Type<TaskCommands>;
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
    taskGit,
    taskCommands,
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
        { provide: TaskGit, useExisting: taskGit },
        { provide: TaskCommands, useExisting: taskCommands },
        TaskStagesService,
        StageRunners,
        StageInterpreter,
        StageGit,
        AgentStageRunner,
        ScriptStageRunner,
      ],
      exports: [PipelineLibraryModule, TaskStagesService],
    };
  }
}
