import { Module, type DynamicModule, type ModuleMetadata, type Type } from "@nestjs/common";
import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { EngineModule } from "../engine/index.js";
import { BusyWorkModule } from "../office-updates/index.js";
import { PipelineProposals } from "./adapters/conversations/pipeline-proposals.js";
import { PipelineLibraryController } from "./adapters/http/pipeline-library.controller.js";
import { TaskGateController } from "./adapters/http/task-gate.controller.js";
import { TaskStagesController } from "./adapters/http/task-stages.controller.js";
import { PostgresStaffingHoldRepository } from "./adapters/postgres/postgres-staffing-hold-repository.js";
import { PipelineOfficeTools } from "./adapters/office-tools/pipeline-office-tools.js";
import { StageBranchUpdate } from "./application/stage-branch-update.js";
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
import { StageGit } from "./application/stage-git.js";
import { StaffingHolds } from "./application/staffing-holds.js";
import { StageInterpreter } from "./application/stage-interpreter.js";
import { StageRunners } from "./application/stage-runners.js";
import { TaskStagesService } from "./application/task-stages-service.js";
import { PipelineLibraryModule } from "./pipeline-library.module.js";
import { KnownPeople } from "./ports/known-people.js";
import { ProjectDefaults } from "./ports/project-defaults.js";
import { ProposalDrafts } from "./ports/proposal-drafts.js";
import { StageDecisions } from "./ports/stage-decisions.js";
import { StageRoleEngines } from "./ports/stage-role-engines.js";
import { StageThreads } from "./ports/stage-threads.js";
import { StaffingHoldRepository } from "./ports/staffing-hold-repository.js";
import { StartedTasks } from "./ports/started-tasks.js";
import { TaskCommands } from "./ports/task-commands.js";
import { TaskGit } from "./ports/task-git.js";
import { TaskPublishing } from "./ports/task-publishing.js";
import { TaskRecords } from "./ports/task-records.js";
import { TaskScreenshots } from "./ports/task-screenshots.js";
import { TaskThreadSessions } from "./ports/task-thread-sessions.js";
import { TaskUsage } from "./ports/task-usage.js";
import { UsageHistoryModule } from "./usage-history.module.js";

export interface PipelinesModuleOptions {
  /**
   * The modules that provide the ports below, Work, People (with its engine cascade),
   * Conversations and Projects, and
   * Conversations' `ProposalAppliers`, which Pipelines fills with its kind of Proposal.
   */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
  readonly startedTasks: Type<StartedTasks>;
  readonly taskRecords: Type<TaskRecords>;
  readonly knownPeople: Type<KnownPeople>;
  readonly projectDefaults: Type<ProjectDefaults>;
  readonly stageThreads: Type<StageThreads>;
  readonly stageDecisions: Type<StageDecisions>;
  readonly taskGit: Type<TaskGit>;
  readonly taskCommands: Type<TaskCommands>;
  readonly taskPublishing: Type<TaskPublishing>;
  readonly taskScreenshots: Type<TaskScreenshots>;
  readonly taskUsage: Type<TaskUsage>;
  readonly taskThreadSessions: Type<TaskThreadSessions>;
  readonly proposalDrafts: Type<ProposalDrafts>;
  readonly stageRoleEngines: Type<StageRoleEngines>;
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
    stageDecisions,
    taskGit,
    taskCommands,
    taskPublishing,
    taskScreenshots,
    taskUsage,
    taskThreadSessions,
    proposalDrafts,
    stageRoleEngines,
  }: PipelinesModuleOptions): DynamicModule {
    return {
      module: PipelinesModule,
      imports: [
        PipelineLibraryModule,
        UsageHistoryModule,
        EngineModule,
        ScheduleModule,
        BusyWorkModule,
        ...imports,
      ],
      controllers: [TaskStagesController, TaskGateController, PipelineLibraryController],
      providers: [
        { provide: StartedTasks, useExisting: startedTasks },
        { provide: TaskRecords, useExisting: taskRecords },
        { provide: KnownPeople, useExisting: knownPeople },
        { provide: ProjectDefaults, useExisting: projectDefaults },
        { provide: StageThreads, useExisting: stageThreads },
        { provide: StageDecisions, useExisting: stageDecisions },
        { provide: TaskGit, useExisting: taskGit },
        { provide: TaskCommands, useExisting: taskCommands },
        { provide: TaskPublishing, useExisting: taskPublishing },
        { provide: TaskScreenshots, useExisting: taskScreenshots },
        { provide: TaskUsage, useExisting: taskUsage },
        { provide: TaskThreadSessions, useExisting: taskThreadSessions },
        { provide: ProposalDrafts, useExisting: proposalDrafts },
        { provide: StageRoleEngines, useExisting: stageRoleEngines },
        { provide: StaffingHoldRepository, useClass: PostgresStaffingHoldRepository },
        RoleFillings,
        TaskStagesService,
        RolesNamedInStages,
        PipelineLibraryEditor,
        StaffingHolds,
        StageRunners,
        StageInterpreter,
        StageGit,
        StageRunWaits,
        ResolveStageGit,
        StageBranchUpdate,
        AgentStageRunner,
        AlarmResumes,
        ScriptStageRunner,
        PublishStage,
        GateStageRunner,
        GateService,
        PipelineProposals,
        PipelineOfficeTools,
        PipelinesWebEvents,
      ],
      exports: [PipelineLibraryModule, TaskStagesService, AlarmResumes],
    };
  }
}
