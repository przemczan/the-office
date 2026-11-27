import { IssueWriteBackForwarding } from "./adapters/projects/issue-write-back-forwarding.js";
import { ProjectsIssueTaskRegistration } from "./adapters/projects/projects-issue-task-registration.js";
import { ProjectsTaskBaseRegistration } from "./adapters/projects/projects-task-base-registration.js";
import { ProjectsTestTargetsSetUpTaskRegistration } from "./adapters/projects/projects-test-targets-set-up-task-registration.js";
import {
  Logger,
  Module,
  RequestMethod,
  type DynamicModule,
  type MiddlewareConsumer,
  type ModuleMetadata,
  type NestModule,
  type OnApplicationBootstrap,
  type Type,
} from "@nestjs/common";
import { uploadBody } from "../../platform/http/upload-body.js";
import { TaskLocksModule } from "../../platform/locks/task-locks.module.js";
import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { BusyWorkModule } from "../busy-work/index.js";
import { EngineModule } from "../engine/index.js";
import { PromptTemplatesModule } from "../prompt-templates/index.js";
import { FilesystemAttachmentFiles } from "./adapters/filesystem/filesystem-attachment-files.js";
import { UnpdfPdfPages } from "./adapters/pdf/unpdf-pdf-pages.js";
import { YauzlZipFiles } from "./adapters/zip/yauzl-zip-files.js";
import { FilesystemWorktreeFiles } from "./adapters/filesystem/worktree-files.js";
import {
  ATTACHMENT_UPLOAD_ROUTES,
  AttachmentsController,
} from "./adapters/http/attachments.controller.js";
import { ArchivePeriodController } from "./adapters/http/archive-period.controller.js";
import { AutoModeController } from "./adapters/http/auto-mode.controller.js";
import { FireAlarmController } from "./adapters/http/fire-alarm.controller.js";
import { IdeasController } from "./adapters/http/ideas.controller.js";
import { InitiativesController } from "./adapters/http/initiatives.controller.js";
import { OfficeLimitsController } from "./adapters/http/office-limits.controller.js";
import { OffBoardTasksController } from "./adapters/http/off-board-tasks.controller.js";
import { OnboardingsController } from "./adapters/http/onboardings.controller.js";
import { SavedViewsController } from "./adapters/http/saved-views.controller.js";
import { PersonTasksController } from "./adapters/http/person-tasks.controller.js";
import { DaysController } from "./adapters/http/days.controller.js";
import { UsageEstimatesController } from "./adapters/http/usage-estimates.controller.js";
import { UsageSettingsController } from "./adapters/http/usage-settings.controller.js";
import { SearchController } from "./adapters/http/search.controller.js";
import { FireAlarmForThreads } from "./adapters/conversations/fire-alarm-for-threads.js";
import { BugTaskProposals } from "./adapters/conversations/bug-task-proposals.js";
import { InitiativeProposals } from "./adapters/conversations/initiative-proposals.js";
import { MentionedWorkRecords } from "./adapters/conversations/mentioned-work-records.js";
import { ThreadMessageImages } from "./adapters/conversations/thread-message-images.js";
import { AvatarSourceFromWork } from "./adapters/people/avatar-source-from-work.js";
import { MemoryTaskTitleSourceFromWork } from "./adapters/people/memory-task-title-source.js";
import { OfficeLimitProposals } from "./adapters/conversations/office-limit-proposals.js";
import { TaskThreadRecords } from "./adapters/conversations/task-thread-records.js";
import { ProjectProposals } from "./adapters/conversations/project-proposals.js";
import { InitiativeThreadRecords } from "./adapters/conversations/initiative-thread-records.js";
import { AttachmentOfficeTools } from "./adapters/office-tools/attachment-office-tools.js";
import { OnboardingOfficeTools } from "./adapters/office-tools/onboarding-office-tools.js";
import { PlanningOfficeTools } from "./adapters/office-tools/planning-office-tools.js";
import { ShapingOfficeTools } from "./adapters/office-tools/shaping-office-tools.js";
import { WorkOfficeActions } from "./adapters/office-actions/work-office-actions.js";
import { WorkSubjectSnapshots } from "./adapters/office-actions/work-subject-snapshots.js";
import { WorkSettingsOfficeActionsController } from "./adapters/http/work-settings-office-actions.controller.js";
import { WorkSettingsOfficeActions } from "./adapters/office-actions/work-settings-office-actions.js";
import { WorkOfficeActionsController } from "./adapters/http/work-office-actions.controller.js";
import { WorkOfficeTools } from "./adapters/office-tools/work-office-tools.js";
import { QueueController } from "./adapters/http/queue.controller.js";
import { TasksController } from "./adapters/http/tasks.controller.js";
import { TestTargetsSetUpsController } from "./adapters/http/test-targets-set-ups.controller.js";
import { TaskResponses } from "./adapters/http/task-responses.js";
import { PostgresAttachmentRepository } from "./adapters/postgres/postgres-attachment-repository.js";
import { PostgresFireAlarmRepository } from "./adapters/postgres/postgres-fire-alarm-repository.js";
import { PostgresIdeaRepository } from "./adapters/postgres/postgres-idea-repository.js";
import { PostgresDayRecords } from "./adapters/postgres/postgres-day-records.js";
import { PostgresInitiativeRepository } from "./adapters/postgres/postgres-initiative-repository.js";
import { PostgresSavedViewRepository } from "./adapters/postgres/postgres-saved-view-repository.js";
import { PostgresQueueRepository } from "./adapters/postgres/postgres-queue-repository.js";
import { PostgresTaskRepository } from "./adapters/postgres/postgres-task-repository.js";
import { PostgresRecordEdits } from "./adapters/postgres/postgres-record-edits.js";
import { WorkEarlierRecords } from "./adapters/postgres/work-earlier-records.js";
import { PostgresWorkSearch } from "./adapters/postgres/postgres-work-search.js";
import { PostgresWorkSettings } from "./adapters/postgres/postgres-work-settings.js";
import { WorkWebEvents } from "./adapters/websocket/work-web-events.js";
import { WorkPromptTemplates } from "./adapters/prompt-templates/work-prompt-templates-registration.js";
import { AttachmentService } from "./application/attachment-service.js";
import { FireAlarmService } from "./application/fire-alarm-service.js";
import { IdeaRecords } from "./application/idea-records.js";
import { IdeaService } from "./application/idea-service.js";
import { InitiativePlanning } from "./application/initiative-planning.js";
import { InitiativePause } from "./application/initiative-pause.js";
import { InitiativeMembership } from "./application/initiative-membership.js";
import { InitiativeStart } from "./application/initiative-start.js";
import { InitiativeBranching } from "./application/initiative-branching.js";
import { InitiativeService } from "./application/initiative-service.js";
import { OfficeLimits } from "./application/office-limits.js";
import { RemovedEngineCaps } from "./application/removed-engine-caps.js";
import { OffBoardTaskReader } from "./application/off-board-task-reader.js";
import { OffBoardTasks } from "./application/off-board-tasks.js";
import { OnboardingService } from "./application/onboarding-service.js";
import { RunEnvironmentSetUps } from "./application/run-environment-set-ups.js";
import { TestTargetsSetUps } from "./application/test-targets-set-ups.js";
import { ConflictResolutions } from "./application/conflict-resolutions.js";
import { PlanningService } from "./application/planning-service.js";
import { SavedViewService } from "./application/saved-view-service.js";
import { SearchService } from "./application/search-service.js";
import { StageScreenshots } from "./application/stage-screenshots.js";
import { UsageWindowResumes } from "./application/usage-window-resumes.js";
import { QueueService } from "./application/queue-service.js";
import { StartConditionsReader } from "./application/start-conditions.js";
import { DailyCaps } from "./application/daily-caps.js";
import { StartsSinceReading } from "./application/starts-since-reading.js";
import { StartService } from "./application/start-service.js";
import { UsageEstimates } from "./application/usage-estimates.js";
import { TaskConnectedDevices } from "./application/task-connected-devices.js";
import { TaskRecords } from "./application/task-records.js";
import { TaskStageEdits } from "./application/task-stage-edits.js";
import { TaskStartOvers } from "./application/task-start-overs.js";
import { TaskWaysBack } from "./application/task-ways-back.js";
import { TaskEngineChecks } from "./application/task-engine-checks.js";
import { WorkEngineLevelMoves } from "./application/work-engine-level-moves.js";
import { TaskArchiving } from "./application/task-archiving.js";
import { InitiativeArchiving } from "./application/initiative-archiving.js";
import { BranchDeletionsController } from "./adapters/http/branch-deletions.controller.js";
import { BranchCleanup } from "./application/branch-cleanup.js";
import { DroppedInitiativeTasks } from "./application/dropped-initiative-tasks.js";
import { DroppedTaskDecisions } from "./application/dropped-task-decisions.js";
import { PlanningAfterRestart } from "./application/planning-after-restart.js";
import { PullRequestOutcomes } from "./application/pull-request-outcomes.js";
import { TaskService } from "./application/task-service.js";
import { PersonTasks } from "./application/person-tasks.js";
import { DaySummaries } from "./application/day-summary.js";
import { ATTACHMENT_SIZE_LIMIT } from "./domain/attachment.js";
import { AttachmentFiles } from "./ports/attachment-files.js";
import { PdfPages } from "./ports/pdf-pages.js";
import { ZipFiles } from "./ports/zip-files.js";
import { AttachmentRepository } from "./ports/attachment-repository.js";
import { FireAlarmRepository } from "./ports/fire-alarm-repository.js";
import { IdeaCards } from "./ports/idea-cards.js";
import { IdeaRepository } from "./ports/idea-repository.js";
import { DayOutcomes } from "./ports/day-outcomes.js";
import { DayRecords } from "./ports/day-records.js";
import { InitiativeRepository } from "./ports/initiative-repository.js";
import { InitiativeThreads } from "./ports/initiative-threads.js";
import { ThreadTurns } from "./ports/thread-turns.js";
import { KnownEngineCascade } from "./ports/known-engine-cascade.js";
import { KnownPeople } from "./ports/known-people.js";
import { KnownPipelines } from "./ports/known-pipelines.js";
import { ModelPrices } from "./ports/model-prices.js";
import { AccountWindowRatios } from "./ports/account-window-ratios.js";
import { AccountWindows } from "./ports/account-windows.js";
import { DayUsage } from "./ports/day-usage.js";
import { KnownProjects } from "./ports/known-projects.js";
import { NewProjects } from "./ports/new-projects.js";
import { ProjectBranchDeletions } from "./ports/project-branch-deletions.js";
import { ProjectInitiativeBranches } from "./ports/project-initiative-branches.js";
import { ProjectWorktrees } from "./ports/project-worktrees.js";
import { StageResults } from "./ports/stage-results.js";
import { TaskPullRequests } from "./ports/task-pull-requests.js";
import { TaskGates } from "./ports/task-gates.js";
import { ProposalDrafts } from "./ports/proposal-drafts.js";
import { SavedViewRepository } from "./ports/saved-view-repository.js";
import { SessionPeople } from "./ports/session-people.js";
import { SessionInitiatives } from "./ports/session-initiatives.js";
import { SessionTasks } from "./ports/session-tasks.js";
import { QueueRepository } from "./ports/queue-repository.js";
import { TaskRepository } from "./ports/task-repository.js";
import { RecordEdits } from "./ports/record-edits.js";
import { TaskDecisions } from "./ports/task-decisions.js";
import { TaskThreads } from "./ports/task-threads.js";
import { TaskTokens } from "./ports/task-tokens.js";
import { WorkSearch } from "./ports/work-search.js";
import { UsageHistory } from "./ports/usage-history.js";
import { WorkSettings } from "./ports/work-settings.js";
import { WorktreeFiles } from "./ports/worktree-files.js";

export interface WorkModuleOptions {
  /**
   * The modules that provide the ports below, Conversations' TaskThreadSetups,
   * InitiativeThreadSetups, WorkRecords, MessageImages and ProposalAppliers, where Work sets up the sessions of
   * Threads on its Tasks and Initiatives, gives the records mentioned in a chat and applies
   * Proposals of the Office-wide limit, of Initiatives and of Projects to onboard, and Projects'
   * TaskBases, where Work tells what each Task's branch starts from, IssueTasks, where it creates
   * the Task of an imported issue, IssueWriteBack, which it tells of those Tasks' starts and
   * ends, and TestTargetsSetUpTasks, where it gives a Project's open "Set up test targets" Task.
   */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
  readonly knownProjects: Type<KnownProjects>;
  readonly newProjects: Type<NewProjects>;
  readonly projectWorktrees: Type<ProjectWorktrees>;
  readonly taskPullRequests: Type<TaskPullRequests>;
  readonly projectInitiativeBranches: Type<ProjectInitiativeBranches>;
  readonly projectBranchDeletions: Type<ProjectBranchDeletions>;
  readonly knownPeople: Type<KnownPeople>;
  readonly knownEngineCascade: Type<KnownEngineCascade>;
  readonly knownPipelines: Type<KnownPipelines>;
  readonly sessionPeople: Type<SessionPeople>;
  readonly ideaCards: Type<IdeaCards>;
  readonly sessionTasks: Type<SessionTasks>;
  readonly sessionInitiatives: Type<SessionInitiatives>;
  readonly taskThreads: Type<TaskThreads>;
  readonly initiativeThreads: Type<InitiativeThreads>;
  /**
   * Whether a Thread has a turn running: ConversationsThreadTurns, Work's adapter over
   * Conversations' ThreadService, made here for Work alone.
   */
  readonly threadTurns: Type<ThreadTurns>;
  readonly taskDecisions: Type<TaskDecisions>;
  readonly proposalDrafts: Type<ProposalDrafts>;
  readonly usageHistory: Type<UsageHistory>;
  readonly stageResults: Type<StageResults>;
  readonly taskGates: Type<TaskGates>;
  readonly modelPrices: Type<ModelPrices>;
  readonly accountWindows: Type<AccountWindows>;
  readonly accountWindowRatios: Type<AccountWindowRatios>;
  readonly dayUsage: Type<DayUsage>;
  readonly dayOutcomes: Type<DayOutcomes>;
  readonly taskTokens: Type<TaskTokens>;
}

@Module({})
export class WorkModule implements NestModule, OnApplicationBootstrap {
  private readonly logger = new Logger(WorkModule.name);

  constructor(private readonly attachments: AttachmentService) {}

  static register({
    imports,
    knownProjects,
    newProjects,
    projectWorktrees,
    taskPullRequests,
    projectInitiativeBranches,
    projectBranchDeletions,
    knownPeople,
    knownEngineCascade,
    knownPipelines,
    sessionPeople,
    ideaCards,
    sessionTasks,
    sessionInitiatives,
    taskThreads,
    initiativeThreads,
    threadTurns,
    taskDecisions,
    proposalDrafts,
    usageHistory,
    stageResults,
    taskGates,
    modelPrices,
    accountWindows,
    accountWindowRatios,
    dayUsage,
    dayOutcomes,
    taskTokens,
  }: WorkModuleOptions): DynamicModule {
    return {
      module: WorkModule,
      // Chats read Work and capture Ideas through Office tools on the Engine's registry.
      imports: [
        ...imports,
        EngineModule,
        ScheduleModule,
        TaskLocksModule,
        BusyWorkModule,
        PromptTemplatesModule,
      ],
      controllers: [
        IdeasController,
        InitiativesController,
        TasksController,
        BranchDeletionsController,
        TestTargetsSetUpsController,
        QueueController,
        AttachmentsController,
        OfficeLimitsController,
        ArchivePeriodController,
        AutoModeController,
        OnboardingsController,
        OffBoardTasksController,
        SearchController,
        SavedViewsController,
        PersonTasksController,
        DaysController,
        UsageEstimatesController,
        UsageSettingsController,
        FireAlarmController,
        WorkOfficeActionsController,
        WorkSettingsOfficeActionsController,
      ],
      providers: [
        { provide: IdeaRepository, useClass: PostgresIdeaRepository },
        { provide: InitiativeRepository, useClass: PostgresInitiativeRepository },
        { provide: TaskRepository, useClass: PostgresTaskRepository },
        { provide: RecordEdits, useClass: PostgresRecordEdits },
        { provide: QueueRepository, useClass: PostgresQueueRepository },
        { provide: AttachmentRepository, useClass: PostgresAttachmentRepository },
        { provide: AttachmentFiles, useClass: FilesystemAttachmentFiles },
        { provide: PdfPages, useClass: UnpdfPdfPages },
        { provide: ZipFiles, useClass: YauzlZipFiles },
        { provide: WorktreeFiles, useClass: FilesystemWorktreeFiles },
        { provide: WorkSearch, useClass: PostgresWorkSearch },
        { provide: SavedViewRepository, useClass: PostgresSavedViewRepository },
        { provide: WorkSettings, useClass: PostgresWorkSettings },
        { provide: FireAlarmRepository, useClass: PostgresFireAlarmRepository },
        { provide: KnownProjects, useExisting: knownProjects },
        { provide: NewProjects, useExisting: newProjects },
        { provide: ProjectWorktrees, useExisting: projectWorktrees },
        { provide: TaskPullRequests, useExisting: taskPullRequests },
        { provide: ProjectInitiativeBranches, useExisting: projectInitiativeBranches },
        { provide: ProjectBranchDeletions, useExisting: projectBranchDeletions },
        { provide: KnownPeople, useExisting: knownPeople },
        { provide: KnownEngineCascade, useExisting: knownEngineCascade },
        { provide: KnownPipelines, useExisting: knownPipelines },
        { provide: SessionPeople, useExisting: sessionPeople },
        { provide: IdeaCards, useExisting: ideaCards },
        { provide: SessionTasks, useExisting: sessionTasks },
        { provide: SessionInitiatives, useExisting: sessionInitiatives },
        { provide: TaskThreads, useExisting: taskThreads },
        { provide: InitiativeThreads, useExisting: initiativeThreads },
        { provide: ThreadTurns, useClass: threadTurns },
        { provide: TaskDecisions, useExisting: taskDecisions },
        { provide: ProposalDrafts, useExisting: proposalDrafts },
        { provide: UsageHistory, useExisting: usageHistory },
        { provide: StageResults, useExisting: stageResults },
        { provide: TaskGates, useExisting: taskGates },
        { provide: ModelPrices, useExisting: modelPrices },
        { provide: AccountWindows, useExisting: accountWindows },
        { provide: AccountWindowRatios, useExisting: accountWindowRatios },
        { provide: DayUsage, useExisting: dayUsage },
        { provide: DayOutcomes, useExisting: dayOutcomes },
        { provide: DayRecords, useClass: PostgresDayRecords },
        { provide: TaskTokens, useExisting: taskTokens },
        IdeaService,
        InitiativeService,
        InitiativeBranching,
        TaskService,
        TaskWaysBack,
        PersonTasks,
        DaySummaries,
        TaskArchiving,
        InitiativeArchiving,
        BranchCleanup,
        DroppedInitiativeTasks,
        DroppedTaskDecisions,
        PullRequestOutcomes,
        PlanningAfterRestart,
        OfficeLimits,
        RemovedEngineCaps,
        OffBoardTaskReader,
        OffBoardTasks,
        OnboardingService,
        RunEnvironmentSetUps,
        TestTargetsSetUps,
        ConflictResolutions,
        AttachmentService,
        SearchService,
        SavedViewService,
        PlanningService,
        InitiativePlanning,
        InitiativeStart,
        InitiativePause,
        InitiativeMembership,
        StartConditionsReader,
        DailyCaps,
        StartsSinceReading,
        StartService,
        UsageEstimates,
        QueueService,
        FireAlarmService,
        UsageWindowResumes,
        TaskConnectedDevices,
        TaskRecords,
        TaskStageEdits,
        TaskStartOvers,
        TaskEngineChecks,
        WorkEngineLevelMoves,
        IdeaRecords,
        StageScreenshots,
        WorkWebEvents,
        TaskResponses,
        WorkPromptTemplates,
        WorkOfficeTools,
        PlanningOfficeTools,
        ShapingOfficeTools,
        WorkOfficeActions,
        WorkSettingsOfficeActions,
        WorkSubjectSnapshots,
        AttachmentOfficeTools,
        OnboardingOfficeTools,
        TaskThreadRecords,
        InitiativeThreadRecords,
        MentionedWorkRecords,
        ThreadMessageImages,
        MemoryTaskTitleSourceFromWork,
        AvatarSourceFromWork,
        OfficeLimitProposals,
        InitiativeProposals,
        ProjectProposals,
        BugTaskProposals,
        FireAlarmForThreads,
        ProjectsTaskBaseRegistration,
        ProjectsIssueTaskRegistration,
        ProjectsTestTargetsSetUpTaskRegistration,
        IssueWriteBackForwarding,
        WorkEarlierRecords,
      ],
      exports: [
        FireAlarmService,
        IdeaService,
        InitiativeService,
        TaskService,
        TaskArchiving,
        InitiativeArchiving,
        BranchCleanup,
        DroppedInitiativeTasks,
        DroppedTaskDecisions,
        PlanningAfterRestart,
        OfficeLimits,
        OffBoardTaskReader,
        OffBoardTasks,
        OnboardingService,
        QueueService,
        UsageWindowResumes,
        RunEnvironmentSetUps,
        TaskConnectedDevices,
        TaskRecords,
        TaskStageEdits,
        TaskStartOvers,
        TaskEngineChecks,
        StageScreenshots,
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(uploadBody(ATTACHMENT_SIZE_LIMIT))
      .forRoutes(...ATTACHMENT_UPLOAD_ROUTES.map((path) => ({ path, method: RequestMethod.POST })));
  }

  /**
   * Before the service takes requests, so the search finds the documents added before it read
   * them, and every file attached before The Office judged files is known to be text or not.
   */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.attachments.fillDocumentTexts();
    } catch (error) {
      // Those left without text are filled at the next start.
      this.logger.warn(`Could not read the documents' text: ${(error as Error).message}`);
    }
    try {
      await this.attachments.judgeFilesAttachedBefore();
    } catch (error) {
      // Those left unjudged are judged at the next start.
      this.logger.warn(`Could not judge the files attached before: ${(error as Error).message}`);
    }
  }
}
