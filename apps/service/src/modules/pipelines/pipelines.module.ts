import { Module, type DynamicModule, type ModuleMetadata, type Type } from "@nestjs/common";
import { TaskLocksModule } from "../../platform/locks/task-locks.module.js";
import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { EngineModule } from "../engine/index.js";
import { BusyWorkModule } from "../busy-work/index.js";
import { PromptTemplatesModule } from "../prompt-templates/index.js";
import { PipelineProposals } from "./adapters/conversations/pipeline-proposals.js";
import { PipelineLibraryController } from "./adapters/http/pipeline-library.controller.js";
import { ProjectPipelineLibraryController } from "./adapters/http/project-pipeline-library.controller.js";
import { StageTemplateLibraryController } from "./adapters/http/stage-template-library.controller.js";
import { PipelinesOfficeActionsController } from "./adapters/http/pipelines-office-actions.controller.js";
import { PromptTemplateOfficeActionsController } from "./adapters/http/prompt-template-office-actions.controller.js";
import { LibraryOfficeActions } from "./adapters/office-actions/library-office-actions.js";
import { PipelinesOfficeActions } from "./adapters/office-actions/pipelines-office-actions.js";
import { PromptTemplateOfficeActions } from "./adapters/office-actions/prompt-template-office-actions.js";
import { SessionPeople } from "./ports/session-people.js";
import { TaskEngineCascadeController } from "./adapters/http/task-engine-cascade.controller.js";
import { TaskStagesController } from "./adapters/http/task-stages.controller.js";
import { PostgresStaffingHoldRepository } from "./adapters/postgres/postgres-staffing-hold-repository.js";
import { PipelineOfficeTools } from "./adapters/office-tools/pipeline-office-tools.js";
import { PipelinesPromptTemplates } from "./adapters/prompt-templates/pipelines-prompt-templates.js";
import { StageBranchUpdate } from "./application/stage-branch-update.js";
import { StageRouteChoices } from "./application/stage-route-choices.js";
import { StageCommandRuns } from "./application/stage-command-runs.js";
import { StandInChoices } from "./application/stand-in-choices.js";
import { StandInSwitches } from "./application/stand-in-switches.js";
import { StandInChoicesController } from "./adapters/http/stand-in-choices.controller.js";
import { StageHistory } from "./application/stage-history.js";
import { StageProjectCommands } from "./application/stage-project-commands.js";
import { StageRunEnvironmentDefinitions } from "./application/stage-run-environment-definitions.js";
import { PipelinesWebEvents } from "./adapters/websocket/pipelines-web-events.js";
import { AgentStageRunner } from "./application/agent-stage-runner.js";
import { AlarmResumes } from "./application/alarm-resumes.js";
import { GateService } from "./application/gate-service.js";
import { GateStageRunner } from "./application/gate-stage-runner.js";
import { PipelineLibraryEditor } from "./application/pipeline-library-editor.js";
import { PublishStage } from "./application/publish-stage.js";
import { RoleFillings } from "./application/role-fillings.js";
import { RolesNamedInStages } from "./application/roles-named-in-stages.js";
import { ScriptStageRunner } from "./application/script-stage-runner.js";
import { ResolveStageGit } from "./application/resolve-stage-git.js";
import { StageRunWaits } from "./application/stage-run-waits.js";
import { StageRunsFiles } from "./application/stage-runs-files.js";
import { ConditionCommands } from "./application/condition-commands.js";
import { StageGit } from "./application/stage-git.js";
import { StaffingHolds } from "./application/staffing-holds.js";
import { StageTemplateLibraryEditor } from "./application/stage-template-library-editor.js";
import { LinkedStages } from "./application/linked-stages.js";
import { StageInterpreter } from "./application/stage-interpreter.js";
import { StageRunsRunningNow } from "./application/stage-runs-running-now.js";
import { DroppedTaskWorktrees } from "./application/dropped-task-worktrees.js";
import { InitiativeBranchStages } from "./application/initiative-branch-stages.js";
import { StageRunners } from "./application/stage-runners.js";
import { TaskRoleEngines } from "./application/task-role-engines.js";
import { TaskStagesService } from "./application/task-stages-service.js";
import { TaskRestarts } from "./application/task-restarts.js";
import { TaskStartOverWork } from "./application/task-start-over-work.js";
import { PipelineLibraryModule } from "./pipeline-library.module.js";
import { KnownPeople } from "./ports/known-people.js";
import { PipelineInitiatives } from "./ports/pipeline-initiatives.js";
import { ProjectDefaults } from "./ports/project-defaults.js";
import { RoleEngineCascade } from "./ports/role-engine-cascade.js";
import { StageDecisions } from "./ports/stage-decisions.js";
import { StageRoleEngines } from "./ports/stage-role-engines.js";
import { StageThreadMessages } from "./ports/stage-thread-messages.js";
import { StageThreads } from "./ports/stage-threads.js";
import { RunEnvironmentDefinitions } from "./ports/run-environment-definitions.js";
import { TaskConsultations } from "./ports/task-consultations.js";
import { StaffingHoldRepository } from "./ports/staffing-hold-repository.js";
import { StartedTasks } from "./ports/started-tasks.js";
import { TaskCommands } from "./ports/task-commands.js";
import { TaskGit } from "./ports/task-git.js";
import { TaskPublishing } from "./ports/task-publishing.js";
import { TaskRecords } from "./ports/task-records.js";
import { TaskScreenshots } from "./ports/task-screenshots.js";
import { TaskThreadSessions } from "./ports/task-thread-sessions.js";
import { TaskUsage } from "./ports/task-usage.js";
import { StageContextLimitDefaults } from "./ports/stage-context-limit-defaults.js";
import { UsageHistoryModule } from "./usage-history.module.js";

export interface PipelinesModuleOptions {
  /**
   * The modules that provide the ports below, Work, People (with its engine cascade),
   * Conversations, Projects and Run environments (Work's Initiatives too), and
   * Conversations' `ProposalAppliers`, which Pipelines fills with its kind of Proposal, Work's
   * `TaskStageEdits`, which it fills with whether a Task's Stages were edited for it, and Work's
   * `TaskStartOvers`, which it fills with its part of a Start over.
   */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
  readonly startedTasks: Type<StartedTasks>;
  readonly taskRecords: Type<TaskRecords>;
  readonly knownPeople: Type<KnownPeople>;
  readonly projectDefaults: Type<ProjectDefaults>;
  readonly stageThreads: Type<StageThreads>;
  readonly stageThreadMessages: Type<StageThreadMessages>;
  readonly stageDecisions: Type<StageDecisions>;
  readonly taskGit: Type<TaskGit>;
  readonly taskCommands: Type<TaskCommands>;
  readonly taskPublishing: Type<TaskPublishing>;
  readonly taskScreenshots: Type<TaskScreenshots>;
  readonly taskUsage: Type<TaskUsage>;
  readonly stageContextLimitDefaults: Type<StageContextLimitDefaults>;
  readonly taskThreadSessions: Type<TaskThreadSessions>;
  readonly sessionPeople: Type<SessionPeople>;
  readonly stageRoleEngines: Type<StageRoleEngines>;
  /** People's engine cascade, for the engines a Task's Roles run on. */
  readonly roleEngineCascade: Type<RoleEngineCascade>;
  readonly runEnvironmentDefinitions: Type<RunEnvironmentDefinitions>;
  /** Conversations' Consultations on Tasks, whose Consultants write the definition too. */
  readonly taskConsultations: Type<TaskConsultations>;
  readonly pipelineInitiatives: Type<PipelineInitiatives>;
}

/**
 * Pipelines whole: the library and its editor, each started Task's own Stages, and the Stage
 * interpreter.
 */
@Module({})
export class PipelinesModule {
  static register({
    imports,
    startedTasks,
    taskRecords,
    knownPeople,
    projectDefaults,
    stageThreads,
    stageThreadMessages,
    stageDecisions,
    taskGit,
    taskCommands,
    taskPublishing,
    taskScreenshots,
    taskUsage,
    stageContextLimitDefaults,
    taskThreadSessions,
    sessionPeople,
    stageRoleEngines,
    roleEngineCascade,
    runEnvironmentDefinitions,
    taskConsultations,
    pipelineInitiatives,
  }: PipelinesModuleOptions): DynamicModule {
    return {
      module: PipelinesModule,
      imports: [
        PipelineLibraryModule,
        UsageHistoryModule,
        EngineModule,
        ScheduleModule,
        TaskLocksModule,
        BusyWorkModule,
        PromptTemplatesModule,
        ...imports,
      ],
      controllers: [
        TaskStagesController,
        TaskEngineCascadeController,
        PipelinesOfficeActionsController,
        PromptTemplateOfficeActionsController,
        PipelineLibraryController,
        ProjectPipelineLibraryController,
        StageTemplateLibraryController,
        StandInChoicesController,
      ],
      providers: [
        { provide: StartedTasks, useExisting: startedTasks },
        { provide: TaskRecords, useExisting: taskRecords },
        { provide: KnownPeople, useExisting: knownPeople },
        { provide: ProjectDefaults, useExisting: projectDefaults },
        { provide: StageThreads, useExisting: stageThreads },
        { provide: StageThreadMessages, useExisting: stageThreadMessages },
        { provide: StageDecisions, useExisting: stageDecisions },
        { provide: TaskGit, useExisting: taskGit },
        { provide: TaskCommands, useExisting: taskCommands },
        { provide: TaskPublishing, useExisting: taskPublishing },
        { provide: TaskScreenshots, useExisting: taskScreenshots },
        { provide: TaskUsage, useExisting: taskUsage },
        { provide: StageContextLimitDefaults, useExisting: stageContextLimitDefaults },
        { provide: TaskThreadSessions, useExisting: taskThreadSessions },
        { provide: SessionPeople, useExisting: sessionPeople },
        { provide: StageRoleEngines, useExisting: stageRoleEngines },
        { provide: RoleEngineCascade, useExisting: roleEngineCascade },
        { provide: RunEnvironmentDefinitions, useExisting: runEnvironmentDefinitions },
        { provide: TaskConsultations, useExisting: taskConsultations },
        { provide: PipelineInitiatives, useExisting: pipelineInitiatives },
        { provide: StaffingHoldRepository, useClass: PostgresStaffingHoldRepository },
        RoleFillings,
        TaskStagesService,
        TaskRoleEngines,
        RolesNamedInStages,
        PipelineLibraryEditor,
        StageTemplateLibraryEditor,
        LinkedStages,
        StaffingHolds,
        StageRunners,
        StageInterpreter,
        StageRunsRunningNow,
        InitiativeBranchStages,
        DroppedTaskWorktrees,
        StageGit,
        StageRunWaits,
        StageRunsFiles,
        ConditionCommands,
        ResolveStageGit,
        StageBranchUpdate,
        StageRouteChoices,
        StageCommandRuns,
        StageProjectCommands,
        StageRunEnvironmentDefinitions,
        AgentStageRunner,
        AlarmResumes,
        ScriptStageRunner,
        PublishStage,
        GateStageRunner,
        GateService,
        TaskRestarts,
        TaskStartOverWork,
        PipelineProposals,
        StageHistory,
        StandInChoices,
        StandInSwitches,
        PipelineOfficeTools,
        PipelinesOfficeActions,
        LibraryOfficeActions,
        PromptTemplateOfficeActions,
        PipelinesPromptTemplates,
        PipelinesWebEvents,
      ],
      exports: [
        PipelineLibraryModule,
        TaskStagesService,
        AlarmResumes,
        StandInChoices,
        StageRunsRunningNow,
      ],
    };
  }
}
