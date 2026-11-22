import {
  Module,
  RequestMethod,
  type DynamicModule,
  type MiddlewareConsumer,
  type ModuleMetadata,
  type NestModule,
  type Type,
} from "@nestjs/common";
import { MESSAGE_IMAGES_TOTAL_BYTES } from "@the-office/contracts";
import { uploadBody } from "../../platform/http/upload-body.js";
import { ScheduleModule } from "../../platform/schedule/schedule.module.js";
import { EngineModule } from "../engine/index.js";
import { PeopleModule } from "../people/index.js";
import { McpServersModule } from "../mcp-servers/index.js";
import { BusyWorkModule } from "../office-updates/index.js";
import { PromptTemplatesModule } from "../prompt-templates/index.js";
import { SkillsModule } from "../skills/index.js";
import { DecisionsController } from "./adapters/http/decisions.controller.js";
import { FireAlarmLiftsController } from "./adapters/http/fire-alarm-lifts.controller.js";
import { LiveViewController } from "./adapters/http/live-view.controller.js";
import { OfficeInstructionsController } from "./adapters/http/office-instructions.controller.js";
import { ProposalsController } from "./adapters/http/proposals.controller.js";
import { SizeThresholdController } from "./adapters/http/size-threshold.controller.js";
import { StageContextLimitsController } from "./adapters/http/stage-context-limits.controller.js";
import {
  THREAD_IMAGE_UPLOAD_ROUTE,
  ThreadsController,
} from "./adapters/http/threads.controller.js";
import { BugTaskOfficeTools } from "./adapters/office-tools/bug-task-office-tools.js";
import { DecisionOfficeTools } from "./adapters/office-tools/decision-office-tools.js";
import { LinkCardOfficeTools } from "./adapters/office-tools/link-card-office-tools.js";
import { ProjectCommandOfficeTools } from "./adapters/office-tools/project-command-office-tools.js";
import { TestTargetOfficeTools } from "./adapters/office-tools/test-target-office-tools.js";
import { ActionOfficeTools } from "./adapters/office-tools/action-office-tools.js";
import { PromptTemplateOfficeTools } from "./adapters/office-tools/prompt-template-office-tools.js";
import { ProposalOfficeTools } from "./adapters/office-tools/proposal-office-tools.js";
import { RoleOfficeTools } from "./adapters/office-tools/role-office-tools.js";
import { SkillOfficeTools } from "./adapters/office-tools/skill-office-tools.js";
import { MemoryOfficeTools } from "./adapters/office-tools/memory-office-tools.js";
import { ThreadHistoryOfficeTool } from "./adapters/office-tools/thread-history-office-tool.js";
import { ConversationsEarlierRecords } from "./adapters/postgres/conversations-earlier-records.js";
import { ConversationsPromptTemplates } from "./adapters/prompt-templates/conversations-prompt-templates.js";
import { PostgresConversationsSettings } from "./adapters/postgres/postgres-conversations-settings.js";
import { PostgresOfficeInstructionsRepository } from "./adapters/postgres/postgres-office-instructions-repository.js";
import { PostgresThreadRepository } from "./adapters/postgres/postgres-thread-repository.js";
import { DutyProposals } from "./adapters/proposals/duty-proposals.js";
import { OfficeInstructionsProposals } from "./adapters/proposals/office-instructions-proposals.js";
import { PromptTemplateProposals } from "./adapters/proposals/prompt-template-proposals.js";
import { SizeThresholdProposals } from "./adapters/proposals/size-threshold-proposals.js";
import { LiveViewWebEvents } from "./adapters/websocket/live-view-web-events.js";
import { ThreadWebEvents } from "./adapters/websocket/thread-web-events.js";
import { Briefs } from "./application/briefs.js";
import { Consultations } from "./application/consultations.js";
import { ContextPolicySettingsService } from "./application/context-policy-settings.js";
import { BugTaskDecisions } from "./application/bug-task-decisions.js";
import { DecisionService } from "./application/decision-service.js";
import { ApprovalHolds } from "./application/approval-holds.js";
import { HeldCalls } from "./application/held-calls.js";
import { FireAlarmInThreads } from "./application/fire-alarm-in-threads.js";
import { FireAlarmLifts } from "./application/fire-alarm-lifts.js";
import { PostgresFireAlarmLiftRepository } from "./adapters/postgres/postgres-fire-alarm-lift-repository.js";
import { FireAlarmLiftRepository } from "./ports/fire-alarm-lift-repository.js";
import { AllowChanges } from "./application/allow-changes.js";
import { PostgresChangesAllowedRepository } from "./adapters/postgres/postgres-changes-allowed-repository.js";
import { PostgresChatActivityRepository } from "./adapters/postgres/postgres-chat-activity-repository.js";
import { ChatActivity } from "./application/chat-activity.js";
import { ChatActivityRepository } from "./ports/chat-activity-repository.js";
import { ChangesAllowedRepository } from "./ports/changes-allowed-repository.js";
import { InterruptedAnswers } from "./application/interrupted-answers.js";
import { SubAgentsAndProcesses } from "./application/sub-agents-and-processes.js";
import { PostgresSubAgentAndProcessRepository } from "./adapters/postgres/postgres-sub-agent-and-process-repository.js";
import { SubAgentsAndProcessesController } from "./adapters/http/sub-agents-and-processes.controller.js";
import { SubAgentAndProcessRepository } from "./ports/sub-agent-and-process-repository.js";
import { LinkCards } from "./application/link-cards.js";
import { LiveView } from "./application/live-view.js";
import { InitiativeThreadSetups } from "./application/initiative-thread-setups.js";
import { MentionedRecords } from "./application/mentioned-records.js";
import { OfficeInstructions } from "./application/office-instructions.js";
import { ProposalAppliers } from "./application/proposal-appliers.js";
import { ProposalService } from "./application/proposal-service.js";
import { ProjectCommandProposals } from "./application/project-command-proposals.js";
import { TestTargetProposals } from "./application/test-target-proposals.js";
import { ActionProposals } from "./application/action-proposals.js";
import { RoleProposals } from "./application/role-proposals.js";
import { SkillInstallProposals } from "./application/skill-install-proposals.js";
import { SkillProposals } from "./application/skill-proposals.js";
import { SkillUpdateProposals } from "./application/skill-update-proposals.js";
import { SessionMemory } from "./application/session-memory.js";
import { SessionPlaces } from "./application/session-places.js";
import { CallChains } from "./application/call-chains.js";
import { StageDecisions } from "./application/stage-decisions.js";
import { StageThreadMessages } from "./application/stage-thread-messages.js";
import { StageThreads } from "./application/stage-threads.js";
import { TaskConversations } from "./application/task-conversations.js";
import { TaskTokens } from "./application/task-tokens.js";
import { TaskThreadSetups } from "./application/task-thread-setups.js";
import { ThreadContexts } from "./application/thread-contexts.js";
import { ThreadSummaries } from "./application/thread-summaries.js";
import { ThreadHistory } from "./application/thread-history.js";
import { ThreadRunner } from "./application/thread-runner.js";
import { ThreadService } from "./application/thread-service.js";
import { WorkRecords } from "./application/work-records.js";
import { MessageImages } from "./application/message-images.js";
import { ThreadImages } from "./application/thread-images.js";
import { ContractMessageImageRules } from "./adapters/http/contract-message-image-rules.js";
import { MessageImageRules } from "./ports/message-image-rules.js";
import { ConversationsSettings } from "./ports/conversations-settings.js";
import { OfficeInstructionsRepository } from "./ports/office-instructions-repository.js";
import { ProjectBases } from "./ports/project-bases.js";
import { ProjectOutputMasks } from "./ports/project-output-masks.js";
import { ProjectRecordSource } from "./ports/project-record-source.js";
import { ThreadRepository } from "./ports/thread-repository.js";

export interface ConversationsModuleOptions {
  /** The modules that provide `projectBases`, `projectOutputMasks` and `projectRecords`. */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
  readonly projectBases: Type<ProjectBases>;
  readonly projectOutputMasks: Type<ProjectOutputMasks>;
  readonly projectRecords: Type<ProjectRecordSource>;
}

@Module({})
export class ConversationsModule implements NestModule {
  static register({
    imports,
    projectBases,
    projectOutputMasks,
    projectRecords,
  }: ConversationsModuleOptions): DynamicModule {
    return {
      module: ConversationsModule,
      // A chat is with a person, whose Role card sets their session; the engine runs it with
      // their skills.
      imports: [
        ...imports,
        PeopleModule,
        EngineModule,
        SkillsModule,
        McpServersModule,
        BusyWorkModule,
        // Sessions load Conversations' prompt templates; the Default person to talk to reads
        // them all and drafts changes to them.
        PromptTemplatesModule,
        // Times how long a session takes to start (SessionStartWatch).
        ScheduleModule,
      ],
      controllers: [
        ThreadsController,
        DecisionsController,
        ProposalsController,
        SizeThresholdController,
        StageContextLimitsController,
        OfficeInstructionsController,
        FireAlarmLiftsController,
        SubAgentsAndProcessesController,
        LiveViewController,
      ],
      providers: [
        { provide: ThreadRepository, useClass: PostgresThreadRepository },
        { provide: ProjectBases, useExisting: projectBases },
        { provide: ProjectOutputMasks, useExisting: projectOutputMasks },
        { provide: ProjectRecordSource, useExisting: projectRecords },
        { provide: ConversationsSettings, useClass: PostgresConversationsSettings },
        { provide: OfficeInstructionsRepository, useClass: PostgresOfficeInstructionsRepository },
        { provide: FireAlarmLiftRepository, useClass: PostgresFireAlarmLiftRepository },
        { provide: ChangesAllowedRepository, useClass: PostgresChangesAllowedRepository },
        { provide: ChatActivityRepository, useClass: PostgresChatActivityRepository },
        {
          provide: SubAgentAndProcessRepository,
          useClass: PostgresSubAgentAndProcessRepository,
        },
        SubAgentsAndProcesses,
        ChatActivity,
        ContextPolicySettingsService,
        OfficeInstructions,
        ThreadService,
        Briefs,
        TaskThreadSetups,
        InitiativeThreadSetups,
        WorkRecords,
        MessageImages,
        ThreadImages,
        { provide: MessageImageRules, useClass: ContractMessageImageRules },
        MentionedRecords,
        SessionMemory,
        SessionPlaces,
        CallChains,
        ThreadContexts,
        ThreadSummaries,
        TaskConversations,
        LiveView,
        ThreadRunner,
        InterruptedAnswers,
        DecisionService,
        BugTaskDecisions,
        Consultations,
        FireAlarmInThreads,
        FireAlarmLifts,
        AllowChanges,
        StageThreads,
        StageThreadMessages,
        StageDecisions,
        TaskTokens,
        ProposalAppliers,
        ProposalService,
        RoleProposals,
        ProjectCommandProposals,
        TestTargetProposals,
        ActionProposals,
        SkillInstallProposals,
        SkillUpdateProposals,
        SkillProposals,
        SizeThresholdProposals,
        OfficeInstructionsProposals,
        DutyProposals,
        PromptTemplateProposals,
        DecisionOfficeTools,
        BugTaskOfficeTools,
        RoleOfficeTools,
        ProposalOfficeTools,
        PromptTemplateOfficeTools,
        ProjectCommandOfficeTools,
        TestTargetOfficeTools,
        ActionOfficeTools,
        SkillOfficeTools,
        LinkCards,
        LinkCardOfficeTools,
        HeldCalls,
        ApprovalHolds,
        MemoryOfficeTools,
        ThreadHistory,
        ThreadHistoryOfficeTool,
        ConversationsPromptTemplates,
        ConversationsEarlierRecords,
        ThreadWebEvents,
        LiveViewWebEvents,
      ],
      exports: [
        ContextPolicySettingsService,
        DecisionService,
        FireAlarmInThreads,
        InterruptedAnswers,
        SubAgentsAndProcesses,
        ThreadService,
        TaskThreadSetups,
        InitiativeThreadSetups,
        WorkRecords,
        MessageImages,
        ProposalAppliers,
        ProposalService,
        StageThreads,
        StageThreadMessages,
        StageDecisions,
        TaskTokens,
        ThreadRunner,
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    // Larger than one image may be, so one too large is refused in the message box's own words.
    consumer
      .apply(uploadBody(MESSAGE_IMAGES_TOTAL_BYTES))
      .forRoutes({ path: THREAD_IMAGE_UPLOAD_ROUTE, method: RequestMethod.POST });
  }
}
