import { Module, type DynamicModule, type ModuleMetadata, type Type } from "@nestjs/common";
import { TaskGateController } from "./adapters/http/task-gate.controller.js";
import { TaskStagesController } from "./adapters/http/task-stages.controller.js";
import { PostgresStageRunRepository } from "./adapters/postgres/postgres-stage-run-repository.js";
import { PostgresTaskStagesRepository } from "./adapters/postgres/postgres-task-stages-repository.js";
import { PipelinesWebEvents } from "./adapters/websocket/pipelines-web-events.js";
import { AgentStageRunner } from "./application/agent-stage-runner.js";
import { GateService } from "./application/gate-service.js";
import { GateStageRunner } from "./application/gate-stage-runner.js";
import { ScriptStageRunner } from "./application/script-stage-runner.js";
import { StageGit } from "./application/stage-git.js";
import { StageInterpreter } from "./application/stage-interpreter.js";
import { StageRunners } from "./application/stage-runners.js";
import { TaskStagesService } from "./application/task-stages-service.js";
import { PipelineLibraryModule } from "./pipeline-library.module.js";
import { KnownPeople } from "./ports/known-people.js";
import { StageDecisions } from "./ports/stage-decisions.js";
import { StageRunRepository } from "./ports/stage-run-repository.js";
import { StageThreads } from "./ports/stage-threads.js";
import { StartedTasks } from "./ports/started-tasks.js";
import { TaskCommands } from "./ports/task-commands.js";
import { TaskGit } from "./ports/task-git.js";
import { TaskRecords } from "./ports/task-records.js";
import { TaskUsage } from "./ports/task-usage.js";
import { TaskStagesRepository } from "./ports/task-stages-repository.js";

export interface PipelinesModuleOptions {
  /** The modules that provide the ports below: Work, People, Conversations and Projects. */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
  readonly startedTasks: Type<StartedTasks>;
  readonly taskRecords: Type<TaskRecords>;
  readonly knownPeople: Type<KnownPeople>;
  readonly stageThreads: Type<StageThreads>;
  readonly stageDecisions: Type<StageDecisions>;
  readonly taskGit: Type<TaskGit>;
  readonly taskCommands: Type<TaskCommands>;
  readonly taskUsage: Type<TaskUsage>;
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
    stageDecisions,
    taskGit,
    taskCommands,
    taskUsage,
  }: PipelinesModuleOptions): DynamicModule {
    return {
      module: PipelinesModule,
      imports: [PipelineLibraryModule, ...imports],
      controllers: [TaskStagesController, TaskGateController],
      providers: [
        { provide: TaskStagesRepository, useClass: PostgresTaskStagesRepository },
        { provide: StageRunRepository, useClass: PostgresStageRunRepository },
        { provide: StartedTasks, useExisting: startedTasks },
        { provide: TaskRecords, useExisting: taskRecords },
        { provide: KnownPeople, useExisting: knownPeople },
        { provide: StageThreads, useExisting: stageThreads },
        { provide: StageDecisions, useExisting: stageDecisions },
        { provide: TaskGit, useExisting: taskGit },
        { provide: TaskCommands, useExisting: taskCommands },
        { provide: TaskUsage, useExisting: taskUsage },
        TaskStagesService,
        StageRunners,
        StageInterpreter,
        StageGit,
        AgentStageRunner,
        ScriptStageRunner,
        GateStageRunner,
        GateService,
        PipelinesWebEvents,
      ],
      exports: [PipelineLibraryModule, TaskStagesService],
    };
  }
}
