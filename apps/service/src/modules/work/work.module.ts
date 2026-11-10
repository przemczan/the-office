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
import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { BusyWorkModule } from "../office-updates/index.js";
import { EngineModule } from "../engine/index.js";
import { FilesystemAttachmentFiles } from "./adapters/filesystem/filesystem-attachment-files.js";
import { UnpdfPdfPages } from "./adapters/pdf/unpdf-pdf-pages.js";
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
import { OnboardingsController } from "./adapters/http/onboardings.controller.js";
import { SavedViewsController } from "./adapters/http/saved-views.controller.js";
import { UsageEstimatesController } from "./adapters/http/usage-estimates.controller.js";
import { UsageSettingsController } from "./adapters/http/usage-settings.controller.js";
import { SearchController } from "./adapters/http/search.controller.js";
import { FireAlarmForThreads } from "./adapters/conversations/fire-alarm-for-threads.js";
import { InitiativeProposals } from "./adapters/conversations/initiative-proposals.js";
import { MentionedWorkRecords } from "./adapters/conversations/mentioned-work-records.js";
import { OfficeLimitProposals } from "./adapters/conversations/office-limit-proposals.js";
import { TaskThreadRecords } from "./adapters/conversations/task-thread-records.js";
import { ProjectProposals } from "./adapters/conversations/project-proposals.js";
import { ShapingThreadSetup } from "./adapters/conversations/shaping-thread-setup.js";
import { AttachmentOfficeTools } from "./adapters/office-tools/attachment-office-tools.js";
import { OnboardingOfficeTools } from "./adapters/office-tools/onboarding-office-tools.js";
import { PlanningOfficeTools } from "./adapters/office-tools/planning-office-tools.js";
import { ShapingOfficeTools } from "./adapters/office-tools/shaping-office-tools.js";
import { WorkOfficeTools } from "./adapters/office-tools/work-office-tools.js";
import { QueueController } from "./adapters/http/queue.controller.js";
import { TasksController } from "./adapters/http/tasks.controller.js";
import { PostgresAttachmentRepository } from "./adapters/postgres/postgres-attachment-repository.js";
import { PostgresFireAlarmRepository } from "./adapters/postgres/postgres-fire-alarm-repository.js";
import { PostgresIdeaRepository } from "./adapters/postgres/postgres-idea-repository.js";
import { PostgresInitiativeRepository } from "./adapters/postgres/postgres-initiative-repository.js";
import { PostgresSavedViewRepository } from "./adapters/postgres/postgres-saved-view-repository.js";
import { PostgresQueueRepository } from "./adapters/postgres/postgres-queue-repository.js";
import { PostgresTaskRepository } from "./adapters/postgres/postgres-task-repository.js";
import { PostgresWorkSearch } from "./adapters/postgres/postgres-work-search.js";
import { PostgresWorkSettings } from "./adapters/postgres/postgres-work-settings.js";
import { WorkWebEvents } from "./adapters/websocket/work-web-events.js";
import { AttachmentService } from "./application/attachment-service.js";
import { FireAlarmService } from "./application/fire-alarm-service.js";
import { IdeaRecords } from "./application/idea-records.js";
import { IdeaService } from "./application/idea-service.js";
import { InitiativeService } from "./application/initiative-service.js";
import { OfficeLimits } from "./application/office-limits.js";
import { RemovedEngineCaps } from "./application/removed-engine-caps.js";
import { OnboardingService } from "./application/onboarding-service.js";
import { RunEnvironmentSetUps } from "./application/run-environment-set-ups.js";
import { PlanningService } from "./application/planning-service.js";
import { SavedViewService } from "./application/saved-view-service.js";
import { SearchService } from "./application/search-service.js";
import { StageScreenshots } from "./application/stage-screenshots.js";
import { QueueService } from "./application/queue-service.js";
import { StartConditionsReader } from "./application/start-conditions.js";
import { DailyCaps } from "./application/daily-caps.js";
import { StartsSinceReading } from "./application/starts-since-reading.js";
import { StartService } from "./application/start-service.js";
import { UsageEstimates } from "./application/usage-estimates.js";
import { TaskRecords } from "./application/task-records.js";
import { TaskArchiving } from "./application/task-archiving.js";
import { InitiativeArchiving } from "./application/initiative-archiving.js";
import { TaskService } from "./application/task-service.js";
import { ATTACHMENT_SIZE_LIMIT } from "./domain/attachment.js";
import { AttachmentFiles } from "./ports/attachment-files.js";
import { PdfPages } from "./ports/pdf-pages.js";
import { AttachmentRepository } from "./ports/attachment-repository.js";
import { FireAlarmRepository } from "./ports/fire-alarm-repository.js";
import { IdeaCards } from "./ports/idea-cards.js";
import { IdeaRepository } from "./ports/idea-repository.js";
import { InitiativeRepository } from "./ports/initiative-repository.js";
import { InitiativeThreads } from "./ports/initiative-threads.js";
import { KnownEngineCascade } from "./ports/known-engine-cascade.js";
import { KnownPeople } from "./ports/known-people.js";
import { KnownPipelines } from "./ports/known-pipelines.js";
import { ModelPrices } from "./ports/model-prices.js";
import { AccountWindowRatios } from "./ports/account-window-ratios.js";
import { AccountWindows } from "./ports/account-windows.js";
import { DayUsage } from "./ports/day-usage.js";
import { KnownProjects } from "./ports/known-projects.js";
import { NewProjects } from "./ports/new-projects.js";
import { ProjectWorktrees } from "./ports/project-worktrees.js";
import { StageResults } from "./ports/stage-results.js";
import { ProposalDrafts } from "./ports/proposal-drafts.js";
import { SavedViewRepository } from "./ports/saved-view-repository.js";
import { SessionPeople } from "./ports/session-people.js";
import { SessionInitiatives } from "./ports/session-initiatives.js";
import { SessionTasks } from "./ports/session-tasks.js";
import { QueueRepository } from "./ports/queue-repository.js";
import { TaskRepository } from "./ports/task-repository.js";
import { TaskDecisions } from "./ports/task-decisions.js";
import { TaskThreads } from "./ports/task-threads.js";
import { TaskTokens } from "./ports/task-tokens.js";
import { WorkSearch } from "./ports/work-search.js";
import { UsageHistory } from "./ports/usage-history.js";
import { WorkSettings } from "./ports/work-settings.js";
import { WorktreeFiles } from "./ports/worktree-files.js";

export interface WorkModuleOptions {
  /**
   * The modules that provide the ports below, and Conversations' TaskThreadSetups,
   * InitiativeThreadSetups, WorkRecords and ProposalAppliers, where Work sets up the sessions of
   * Threads on its Tasks and Initiatives, gives the records mentioned in a chat and applies
   * Proposals of the Office-wide limit, of Initiatives and of Projects to onboard.
   */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
  readonly knownProjects: Type<KnownProjects>;
  readonly newProjects: Type<NewProjects>;
  readonly projectWorktrees: Type<ProjectWorktrees>;
  readonly knownPeople: Type<KnownPeople>;
  readonly knownEngineCascade: Type<KnownEngineCascade>;
  readonly knownPipelines: Type<KnownPipelines>;
  readonly sessionPeople: Type<SessionPeople>;
  readonly ideaCards: Type<IdeaCards>;
  readonly sessionTasks: Type<SessionTasks>;
  readonly sessionInitiatives: Type<SessionInitiatives>;
  readonly taskThreads: Type<TaskThreads>;
  readonly initiativeThreads: Type<InitiativeThreads>;
  readonly taskDecisions: Type<TaskDecisions>;
  readonly proposalDrafts: Type<ProposalDrafts>;
  readonly usageHistory: Type<UsageHistory>;
  readonly stageResults: Type<StageResults>;
  readonly modelPrices: Type<ModelPrices>;
  readonly accountWindows: Type<AccountWindows>;
  readonly accountWindowRatios: Type<AccountWindowRatios>;
  readonly dayUsage: Type<DayUsage>;
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
    knownPeople,
    knownEngineCascade,
    knownPipelines,
    sessionPeople,
    ideaCards,
    sessionTasks,
    sessionInitiatives,
    taskThreads,
    initiativeThreads,
    taskDecisions,
    proposalDrafts,
    usageHistory,
    stageResults,
    modelPrices,
    accountWindows,
    accountWindowRatios,
    dayUsage,
    taskTokens,
  }: WorkModuleOptions): DynamicModule {
    return {
      module: WorkModule,
      // Chats read Work and capture Ideas through Office tools on the Engine's registry.
      imports: [...imports, EngineModule, ScheduleModule, BusyWorkModule],
      controllers: [
        IdeasController,
        InitiativesController,
        TasksController,
        QueueController,
        AttachmentsController,
        OfficeLimitsController,
        ArchivePeriodController,
        AutoModeController,
        OnboardingsController,
        SearchController,
        SavedViewsController,
        UsageEstimatesController,
        UsageSettingsController,
        FireAlarmController,
      ],
      providers: [
        { provide: IdeaRepository, useClass: PostgresIdeaRepository },
        { provide: InitiativeRepository, useClass: PostgresInitiativeRepository },
        { provide: TaskRepository, useClass: PostgresTaskRepository },
        { provide: QueueRepository, useClass: PostgresQueueRepository },
        { provide: AttachmentRepository, useClass: PostgresAttachmentRepository },
        { provide: AttachmentFiles, useClass: FilesystemAttachmentFiles },
        { provide: PdfPages, useClass: UnpdfPdfPages },
        { provide: WorktreeFiles, useClass: FilesystemWorktreeFiles },
        { provide: WorkSearch, useClass: PostgresWorkSearch },
        { provide: SavedViewRepository, useClass: PostgresSavedViewRepository },
        { provide: WorkSettings, useClass: PostgresWorkSettings },
        { provide: FireAlarmRepository, useClass: PostgresFireAlarmRepository },
        { provide: KnownProjects, useExisting: knownProjects },
        { provide: NewProjects, useExisting: newProjects },
        { provide: ProjectWorktrees, useExisting: projectWorktrees },
        { provide: KnownPeople, useExisting: knownPeople },
        { provide: KnownEngineCascade, useExisting: knownEngineCascade },
        { provide: KnownPipelines, useExisting: knownPipelines },
        { provide: SessionPeople, useExisting: sessionPeople },
        { provide: IdeaCards, useExisting: ideaCards },
        { provide: SessionTasks, useExisting: sessionTasks },
        { provide: SessionInitiatives, useExisting: sessionInitiatives },
        { provide: TaskThreads, useExisting: taskThreads },
        { provide: InitiativeThreads, useExisting: initiativeThreads },
        { provide: TaskDecisions, useExisting: taskDecisions },
        { provide: ProposalDrafts, useExisting: proposalDrafts },
        { provide: UsageHistory, useExisting: usageHistory },
        { provide: StageResults, useExisting: stageResults },
        { provide: ModelPrices, useExisting: modelPrices },
        { provide: AccountWindows, useExisting: accountWindows },
        { provide: AccountWindowRatios, useExisting: accountWindowRatios },
        { provide: DayUsage, useExisting: dayUsage },
        { provide: TaskTokens, useExisting: taskTokens },
        IdeaService,
        InitiativeService,
        TaskService,
        TaskArchiving,
        InitiativeArchiving,
        OfficeLimits,
        RemovedEngineCaps,
        OnboardingService,
        RunEnvironmentSetUps,
        AttachmentService,
        SearchService,
        SavedViewService,
        PlanningService,
        StartConditionsReader,
        DailyCaps,
        StartsSinceReading,
        StartService,
        UsageEstimates,
        QueueService,
        FireAlarmService,
        TaskRecords,
        IdeaRecords,
        StageScreenshots,
        WorkWebEvents,
        WorkOfficeTools,
        PlanningOfficeTools,
        ShapingOfficeTools,
        AttachmentOfficeTools,
        OnboardingOfficeTools,
        TaskThreadRecords,
        ShapingThreadSetup,
        MentionedWorkRecords,
        OfficeLimitProposals,
        InitiativeProposals,
        ProjectProposals,
        FireAlarmForThreads,
      ],
      exports: [
        FireAlarmService,
        IdeaService,
        TaskService,
        TaskArchiving,
        InitiativeArchiving,
        OfficeLimits,
        QueueService,
        RunEnvironmentSetUps,
        TaskRecords,
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
