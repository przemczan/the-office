import { Module, type DynamicModule, type ModuleMetadata, type Type } from "@nestjs/common";
import { EngineModule } from "../engine/index.js";
import { PeopleModule } from "../people/index.js";
import { McpServersModule } from "../mcp-servers/index.js";
import { SkillsModule } from "../skills/index.js";
import { DecisionsController } from "./adapters/http/decisions.controller.js";
import { FireAlarmLiftsController } from "./adapters/http/fire-alarm-lifts.controller.js";
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
import { PostgresConversationsSettings } from "./adapters/postgres/postgres-conversations-settings.js";
import { PostgresThreadRepository } from "./adapters/postgres/postgres-thread-repository.js";
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
import { ChangesAllowedRepository } from "./ports/changes-allowed-repository.js";
import { InterruptedAnswers } from "./application/interrupted-answers.js";
import { LinkCards } from "./application/link-cards.js";
import { InitiativeThreadSetups } from "./application/initiative-thread-setups.js";
import { MentionedRecords } from "./application/mentioned-records.js";
import { ProposalAppliers } from "./application/proposal-appliers.js";
import { ProposalService } from "./application/proposal-service.js";
import { ProjectCommandProposals } from "./application/project-command-proposals.js";
import { RoleProposals } from "./application/role-proposals.js";
import { SkillInstallProposals } from "./application/skill-install-proposals.js";
import { SkillProposals } from "./application/skill-proposals.js";
import { SkillUpdateProposals } from "./application/skill-update-proposals.js";
import { SessionMemory } from "./application/session-memory.js";
import { SessionPlaces } from "./application/session-places.js";
import { StageDecisions } from "./application/stage-decisions.js";
import { StageThreads } from "./application/stage-threads.js";
import { TaskTokens } from "./application/task-tokens.js";
import { TaskThreadSetups } from "./application/task-thread-setups.js";
import { ThreadContexts } from "./application/thread-contexts.js";
import { ThreadRunner } from "./application/thread-runner.js";
import { ThreadService } from "./application/thread-service.js";
import { WorkRecords } from "./application/work-records.js";
import { ConversationsSettings } from "./ports/conversations-settings.js";
import { ProjectBases } from "./ports/project-bases.js";
import { ThreadRepository } from "./ports/thread-repository.js";

export interface ConversationsModuleOptions {
  /** The modules that provide `projectBases`. */
  readonly imports: NonNullable<ModuleMetadata["imports"]>;
  readonly projectBases: Type<ProjectBases>;
}

@Module({})
export class ConversationsModule {
  static register({ imports, projectBases }: ConversationsModuleOptions): DynamicModule {
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
        FireAlarmLiftsController,
      ],
      providers: [
        { provide: ThreadRepository, useClass: PostgresThreadRepository },
        { provide: ProjectBases, useExisting: projectBases },
        { provide: ConversationsSettings, useClass: PostgresConversationsSettings },
        { provide: FireAlarmLiftRepository, useClass: PostgresFireAlarmLiftRepository },
        { provide: ChangesAllowedRepository, useClass: PostgresChangesAllowedRepository },
        ContextPolicySettingsService,
        ThreadService,
        Briefs,
        TaskThreadSetups,
        InitiativeThreadSetups,
        WorkRecords,
        MentionedRecords,
        SessionMemory,
        SessionPlaces,
        ThreadContexts,
        ThreadRunner,
        InterruptedAnswers,
        DecisionService,
        Consultations,
        FireAlarmInThreads,
        FireAlarmLifts,
        AllowChanges,
        StageThreads,
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
        ThreadWebEvents,
      ],
      exports: [
        DecisionService,
        FireAlarmInThreads,
        InterruptedAnswers,
        ThreadService,
        TaskThreadSetups,
        InitiativeThreadSetups,
        WorkRecords,
        ProposalAppliers,
        ProposalService,
        StageThreads,
        StageDecisions,
        TaskTokens,
        ThreadRunner,
      ],
    };
  }
}
