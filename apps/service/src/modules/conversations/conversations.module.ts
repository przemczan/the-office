import { Module, type DynamicModule, type ModuleMetadata, type Type } from "@nestjs/common";
import { EngineModule } from "../engine/index.js";
import { PeopleModule } from "../people/index.js";
import { SkillsModule } from "../skills/index.js";
import { DecisionsController } from "./adapters/http/decisions.controller.js";
import { SizeThresholdController } from "./adapters/http/size-threshold.controller.js";
import { ThreadsController } from "./adapters/http/threads.controller.js";
import { DecisionOfficeTools } from "./adapters/office-tools/decision-office-tools.js";
import { RoleOfficeTools } from "./adapters/office-tools/role-office-tools.js";
import { MemoryOfficeTools } from "./adapters/office-tools/memory-office-tools.js";
import { PostgresConversationsSettings } from "./adapters/postgres/postgres-conversations-settings.js";
import { PostgresThreadRepository } from "./adapters/postgres/postgres-thread-repository.js";
import { ThreadWebEvents } from "./adapters/websocket/thread-web-events.js";
import { Briefs } from "./application/briefs.js";
import { ContextPolicySettingsService } from "./application/context-policy-settings.js";
import { DecisionService } from "./application/decision-service.js";
import { HeldCalls } from "./application/held-calls.js";
import { InterruptedAnswers } from "./application/interrupted-answers.js";
import { SessionMemory } from "./application/session-memory.js";
import { SessionPlaces } from "./application/session-places.js";
import { StageDecisions } from "./application/stage-decisions.js";
import { StageThreads } from "./application/stage-threads.js";
import { TaskTokens } from "./application/task-tokens.js";
import { TaskThreadSetups } from "./application/task-thread-setups.js";
import { ThreadContexts } from "./application/thread-contexts.js";
import { ThreadRunner } from "./application/thread-runner.js";
import { ThreadService } from "./application/thread-service.js";
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
      imports: [...imports, PeopleModule, EngineModule, SkillsModule],
      controllers: [ThreadsController, DecisionsController, SizeThresholdController],
      providers: [
        { provide: ThreadRepository, useClass: PostgresThreadRepository },
        { provide: ProjectBases, useExisting: projectBases },
        { provide: ConversationsSettings, useClass: PostgresConversationsSettings },
        ContextPolicySettingsService,
        ThreadService,
        Briefs,
        TaskThreadSetups,
        SessionMemory,
        SessionPlaces,
        ThreadContexts,
        ThreadRunner,
        InterruptedAnswers,
        DecisionService,
        StageThreads,
        StageDecisions,
        TaskTokens,
        DecisionOfficeTools,
        RoleOfficeTools,
        HeldCalls,
        MemoryOfficeTools,
        ThreadWebEvents,
      ],
      exports: [
        DecisionService,
        InterruptedAnswers,
        ThreadService,
        TaskThreadSetups,
        StageThreads,
        StageDecisions,
        TaskTokens,
        ThreadRunner,
      ],
    };
  }
}
