import {
  Module,
  RequestMethod,
  type DynamicModule,
  type MiddlewareConsumer,
  type ModuleMetadata,
  type NestModule,
  type Type,
} from "@nestjs/common";
import { uploadBody } from "../../platform/http/upload-body.js";
import { EngineModule } from "../engine/index.js";
import { FilesystemAttachmentFiles } from "./adapters/filesystem/filesystem-attachment-files.js";
import { FilesystemWorktreeFiles } from "./adapters/filesystem/worktree-files.js";
import {
  ATTACHMENT_UPLOAD_ROUTES,
  AttachmentsController,
} from "./adapters/http/attachments.controller.js";
import { IdeasController } from "./adapters/http/ideas.controller.js";
import { InitiativesController } from "./adapters/http/initiatives.controller.js";
import { OfficeLimitsController } from "./adapters/http/office-limits.controller.js";
import { InitiativeProposals } from "./adapters/conversations/initiative-proposals.js";
import { MentionedWorkRecords } from "./adapters/conversations/mentioned-work-records.js";
import { OfficeLimitProposals } from "./adapters/conversations/office-limit-proposals.js";
import { PlanningThreadSetup } from "./adapters/conversations/planning-thread-setup.js";
import { ShapingThreadSetup } from "./adapters/conversations/shaping-thread-setup.js";
import { AttachmentOfficeTools } from "./adapters/office-tools/attachment-office-tools.js";
import { PlanningOfficeTools } from "./adapters/office-tools/planning-office-tools.js";
import { ShapingOfficeTools } from "./adapters/office-tools/shaping-office-tools.js";
import { WorkOfficeTools } from "./adapters/office-tools/work-office-tools.js";
import { TasksController } from "./adapters/http/tasks.controller.js";
import { PostgresAttachmentRepository } from "./adapters/postgres/postgres-attachment-repository.js";
import { PostgresIdeaRepository } from "./adapters/postgres/postgres-idea-repository.js";
import { PostgresInitiativeRepository } from "./adapters/postgres/postgres-initiative-repository.js";
import { PostgresTaskRepository } from "./adapters/postgres/postgres-task-repository.js";
import { PostgresWorkSettings } from "./adapters/postgres/postgres-work-settings.js";
import { WorkWebEvents } from "./adapters/websocket/work-web-events.js";
import { AttachmentService } from "./application/attachment-service.js";
import { IdeaService } from "./application/idea-service.js";
import { InitiativeService } from "./application/initiative-service.js";
import { OfficeLimits } from "./application/office-limits.js";
import { PlanningService } from "./application/planning-service.js";
import { StageScreenshots } from "./application/stage-screenshots.js";
import { StartService } from "./application/start-service.js";
import { TaskRecords } from "./application/task-records.js";
import { TaskService } from "./application/task-service.js";
import { ATTACHMENT_SIZE_LIMIT } from "./domain/attachment.js";
import { AttachmentFiles } from "./ports/attachment-files.js";
import { AttachmentRepository } from "./ports/attachment-repository.js";
import { IdeaCards } from "./ports/idea-cards.js";
import { IdeaRepository } from "./ports/idea-repository.js";
import { InitiativeRepository } from "./ports/initiative-repository.js";
import { InitiativeThreads } from "./ports/initiative-threads.js";
import { KnownPeople } from "./ports/known-people.js";
import { KnownPipelines } from "./ports/known-pipelines.js";
import { KnownProjects } from "./ports/known-projects.js";
import { ProjectWorktrees } from "./ports/project-worktrees.js";
import { ProposalDrafts } from "./ports/proposal-drafts.js";
import { SessionPeople } from "./ports/session-people.js";
import { SessionInitiatives } from "./ports/session-initiatives.js";
import { SessionTasks } from "./ports/session-tasks.js";
import { TaskRepository } from "./ports/task-repository.js";
import { TaskDecisions } from "./ports/task-decisions.js";
import { TaskThreads } from "./ports/task-threads.js";
import { WorkSettings } from "./ports/work-settings.js";
import { WorktreeFiles } from "./ports/worktree-files.js";

export interface WorkModuleOptions {
  /**
   * The modules that provide the ports below, and Conversations' TaskThreadSetups,
   * InitiativeThreadSetups, WorkRecords and ProposalAppliers, where Work sets up the sessions of
   * Threads on its Tasks and Initiatives, gives the records mentioned in a chat and applies
   * Proposals of the Office-wide limit and of Initiatives.
   */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
  readonly knownProjects: Type<KnownProjects>;
  readonly projectWorktrees: Type<ProjectWorktrees>;
  readonly knownPeople: Type<KnownPeople>;
  readonly knownPipelines: Type<KnownPipelines>;
  readonly sessionPeople: Type<SessionPeople>;
  readonly ideaCards: Type<IdeaCards>;
  readonly sessionTasks: Type<SessionTasks>;
  readonly sessionInitiatives: Type<SessionInitiatives>;
  readonly taskThreads: Type<TaskThreads>;
  readonly initiativeThreads: Type<InitiativeThreads>;
  readonly taskDecisions: Type<TaskDecisions>;
  readonly proposalDrafts: Type<ProposalDrafts>;
}

@Module({})
export class WorkModule implements NestModule {
  static register({
    imports,
    knownProjects,
    projectWorktrees,
    knownPeople,
    knownPipelines,
    sessionPeople,
    ideaCards,
    sessionTasks,
    sessionInitiatives,
    taskThreads,
    initiativeThreads,
    taskDecisions,
    proposalDrafts,
  }: WorkModuleOptions): DynamicModule {
    return {
      module: WorkModule,
      // Chats read Work and capture Ideas through Office tools on the Engine's registry.
      imports: [...imports, EngineModule],
      controllers: [
        IdeasController,
        InitiativesController,
        TasksController,
        AttachmentsController,
        OfficeLimitsController,
      ],
      providers: [
        { provide: IdeaRepository, useClass: PostgresIdeaRepository },
        { provide: InitiativeRepository, useClass: PostgresInitiativeRepository },
        { provide: TaskRepository, useClass: PostgresTaskRepository },
        { provide: AttachmentRepository, useClass: PostgresAttachmentRepository },
        { provide: AttachmentFiles, useClass: FilesystemAttachmentFiles },
        { provide: WorktreeFiles, useClass: FilesystemWorktreeFiles },
        { provide: WorkSettings, useClass: PostgresWorkSettings },
        { provide: KnownProjects, useExisting: knownProjects },
        { provide: ProjectWorktrees, useExisting: projectWorktrees },
        { provide: KnownPeople, useExisting: knownPeople },
        { provide: KnownPipelines, useExisting: knownPipelines },
        { provide: SessionPeople, useExisting: sessionPeople },
        { provide: IdeaCards, useExisting: ideaCards },
        { provide: SessionTasks, useExisting: sessionTasks },
        { provide: SessionInitiatives, useExisting: sessionInitiatives },
        { provide: TaskThreads, useExisting: taskThreads },
        { provide: InitiativeThreads, useExisting: initiativeThreads },
        { provide: TaskDecisions, useExisting: taskDecisions },
        { provide: ProposalDrafts, useExisting: proposalDrafts },
        IdeaService,
        InitiativeService,
        TaskService,
        OfficeLimits,
        AttachmentService,
        PlanningService,
        StartService,
        TaskRecords,
        StageScreenshots,
        WorkWebEvents,
        WorkOfficeTools,
        PlanningOfficeTools,
        ShapingOfficeTools,
        AttachmentOfficeTools,
        PlanningThreadSetup,
        ShapingThreadSetup,
        MentionedWorkRecords,
        OfficeLimitProposals,
        InitiativeProposals,
      ],
      exports: [IdeaService, TaskService, OfficeLimits, TaskRecords, StageScreenshots],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(uploadBody(ATTACHMENT_SIZE_LIMIT))
      .forRoutes(...ATTACHMENT_UPLOAD_ROUTES.map((path) => ({ path, method: RequestMethod.POST })));
  }
}
