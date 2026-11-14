import { Module, type DynamicModule, type ModuleMetadata, type Type } from "@nestjs/common";
import { EngineModule } from "../engine/index.js";
import { PeopleModule } from "../people/index.js";
import { McpServersModule } from "../mcp-servers/index.js";
import { SkillsModule } from "../skills/index.js";
import { DecisionsController } from "./adapters/http/decisions.controller.js";
import { FireAlarmLiftsController } from "./adapters/http/fire-alarm-lifts.controller.js";
import { OfficeInstructionsController } from "./adapters/http/office-instructions.controller.js";
import { ProposalsController } from "./adapters/http/proposals.controller.js";
import { SizeThresholdController } from "./adapters/http/size-threshold.controller.js";
import { ThreadsController } from "./adapters/http/threads.controller.js";
import { DecisionOfficeTools } from "./adapters/office-tools/decision-office-tools.js";
import { LinkCardOfficeTools } from "./adapters/office-tools/link-card-office-tools.js";
import { ProjectCommandOfficeTools } from "./adapters/office-tools/project-command-office-tools.js";
import { ProposalOfficeTools } from "./adapters/office-tools/proposal-office-tools.js";
import { RoleOfficeTools } from "./adapters/office-tools/role-office-tools.js";
import { SkillOfficeTools } from "./adapters/office-tools/skill-office-tools.js";
import { MemoryOfficeTools } from "./adapters/office-tools/memory-office-tools.js";
import { ThreadHistoryOfficeTool } from "./adapters/office-tools/thread-history-office-tool.js";
import { PostgresConversationsSettings } from "./adapters/postgres/postgres-conversations-settings.js";
import { PostgresOfficeInstructionsRepository } from "./adapters/postgres/postgres-office-instructions-repository.js";
import { PostgresThreadRepository } from "./adapters/postgres/postgres-thread-repository.js";
import { DutyProposals } from "./adapters/proposals/duty-proposals.js";
import { OfficeInstructionsProposals } from "./adapters/proposals/office-instructions-proposals.js";
import { SizeThresholdProposals } from "./adapters/proposals/size-threshold-proposals.js";
import { ThreadWebEvents } from "./adapters/websocket/thread-web-events.js";
import { Briefs } from "./application/briefs.js";
import { Consultations } from "./application/consultations.js";
import { ContextPolicySettingsService } from "./application/context-policy-settings.js";
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
import { InitiativeThreadSetups } from "./application/initiative-thread-setups.js";
import { MentionedRecords } from "./application/mentioned-records.js";
import { OfficeInstructions } from "./application/office-instructions.js";
import { ProposalAppliers } from "./application/proposal-appliers.js";
import { ProposalService } from "./application/proposal-service.js";
import { ProjectCommandProposals } from "./application/project-command-proposals.js";
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
import { ThreadHistory } from "./application/thread-history.js";
import { ThreadRunner } from "./application/thread-runner.js";
import { ThreadService } from "./application/thread-service.js";
import { WorkRecords } from "./application/work-records.js";
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
export class ConversationsModule {
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
      imports: [...imports, PeopleModule, EngineModule, SkillsModule, McpServersModule],
      controllers: [
        ThreadsController,
        DecisionsController,
        ProposalsController,
        SizeThresholdController,
        OfficeInstructionsController,
        FireAlarmLiftsController,
        SubAgentsAndProcessesController,
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
        MentionedRecords,
        SessionMemory,
        SessionPlaces,
        CallChains,
        ThreadContexts,
        TaskConversations,
        ThreadRunner,
        InterruptedAnswers,
        DecisionService,
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
        SkillInstallProposals,
        SkillUpdateProposals,
        SkillProposals,
        SizeThresholdProposals,
        OfficeInstructionsProposals,
        DutyProposals,
        DecisionOfficeTools,
        RoleOfficeTools,
        ProposalOfficeTools,
        ProjectCommandOfficeTools,
        SkillOfficeTools,
        LinkCards,
        LinkCardOfficeTools,
        HeldCalls,
        ApprovalHolds,
        MemoryOfficeTools,
        ThreadHistory,
        ThreadHistoryOfficeTool,
        ThreadWebEvents,
      ],
      exports: [
        DecisionService,
        FireAlarmInThreads,
        InterruptedAnswers,
        SubAgentsAndProcesses,
        ThreadService,
        TaskThreadSetups,
        InitiativeThreadSetups,
        WorkRecords,
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
}
