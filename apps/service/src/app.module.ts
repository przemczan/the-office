import { fileURLToPath } from "node:url";
import { Module, type DynamicModule } from "@nestjs/common";
import {
  ConversationsModule,
  DecisionService,
  ProposalService,
  StageDecisions,
  StageThreads,
  TaskTokens,
  ThreadRunner,
  ThreadService,
} from "./modules/conversations/index.js";
import {
  DayUsage,
  EngineAccountsModule,
  EngineModule,
  ModelPrices,
  UsageWindowSamples,
  UsageWindowState,
} from "./modules/engine/index.js";
import { GitHubAccess, GitHubModule } from "./modules/github/index.js";
import { NotificationsModule } from "./modules/notifications/index.js";
import {
  EngineCascade,
  EngineCascadeModule,
  PeopleModule,
  PipelineRoleCapabilityChecks,
  RoleCards,
} from "./modules/people/index.js";
import {
  AlarmResumes,
  PipelineLibrary,
  PipelineLibraryModule,
  PipelinesModule,
  TaskStagesService,
  StageResultWords,
  UsageHistory,
  UsageHistoryModule,
} from "./modules/pipelines/index.js";
import {
  BaseCheckouts,
  EngineLevelsChecks,
  InitiativeBranches,
  ProjectRecords,
  ProjectService,
  ProjectsFromRepositories,
  ProjectsModule,
  TaskWorktrees,
} from "./modules/projects/index.js";
import { McpServersModule } from "./modules/mcp-servers/index.js";
import {
  RunEnvironmentDefinitions,
  RunEnvironmentsModule,
} from "./modules/run-environments/index.js";
import { OfficeUpdatesModule } from "./modules/office-updates/index.js";
import { SkillsModule } from "./modules/skills/index.js";
import {
  FireAlarmService,
  InitiativeService,
  OfficeLimits,
  QueueService,
  StageScreenshots,
  TaskRecords,
  TaskService,
  WorkModule,
} from "./modules/work/index.js";
import type { OfficeConfig } from "./platform/config/office-config.js";
import { DatabaseModule } from "./platform/database/database.module.js";
import { EventsModule } from "./platform/events/events.module.js";
import { GitHubUserTokenModule } from "./platform/git-identity/git-identity.module.js";
import { OfficeIdentityHttpModule } from "./platform/git-identity/office-identity-http.module.js";
import { HealthModule } from "./platform/health/health.module.js";
import { OfficeDataModule } from "./platform/office-data/office-data.module.js";
import { TelemetryModule } from "./platform/telemetry/telemetry.module.js";
import { WebAppModule, type WebAppOptions } from "./platform/web-app/web-app.module.js";
import { EventStreamModule } from "./platform/websocket/event-stream.module.js";
import { WorkstationModule } from "./platform/workstation/workstation.module.js";

// The Office's own git checkout, from this file in apps/service/src/ or dist/.
const OFFICE_CHECKOUT = fileURLToPath(new URL("../../../", import.meta.url));

@Module({})
export class AppModule {
  static register(
    config: OfficeConfig,
    webApp: WebAppOptions,
    officeCheckout: string = OFFICE_CHECKOUT,
  ): DynamicModule {
    // One instance, so every token read goes through the same sign-in changes and refreshes once.
    const github = GitHubModule.register({ web: config.gitHub.webUrl, api: config.gitHub.apiUrl });
    // One instance, so every git change on a repository goes through the same locks.
    const projects = ProjectsModule.register({
      imports: [PipelineLibraryModule, github],
      knownPipelines: PipelineLibrary,
    });
    const engineCascade = EngineCascadeModule.register({
      imports: [projects, PipelineLibraryModule],
      knownProjectLevels: ProjectService,
      projectLevelsSaves: EngineLevelsChecks,
    });
    const conversations = ConversationsModule.register({
      imports: [projects, engineCascade],
      projectBases: BaseCheckouts,
      projectOutputMasks: ProjectService,
      projectRecords: ProjectRecords,
    });
    const work = WorkModule.register({
      imports: [
        projects,
        conversations,
        engineCascade,
        PeopleModule,
        PipelineLibraryModule,
        UsageHistoryModule,
      ],
      knownProjects: ProjectService,
      newProjects: ProjectsFromRepositories,
      projectWorktrees: TaskWorktrees,
      projectInitiativeBranches: InitiativeBranches,
      knownPeople: RoleCards,
      knownEngineCascade: EngineCascade,
      knownPipelines: PipelineLibrary,
      sessionPeople: ThreadService,
      ideaCards: ThreadService,
      sessionTasks: ThreadService,
      sessionInitiatives: ThreadService,
      taskThreads: ThreadService,
      initiativeThreads: ThreadService,
      taskDecisions: DecisionService,
      proposalDrafts: ProposalService,
      usageHistory: UsageHistory,
      stageResults: StageResultWords,
      modelPrices: ModelPrices,
      accountWindows: UsageWindowState,
      accountWindowRatios: UsageWindowSamples,
      dayUsage: DayUsage,
      taskTokens: TaskTokens,
    });
    // Work's Tasks tell the startup sweep which run environments to keep; a Project's Run
    // environment setting is kept by Projects, and its set-up Task by Work.
    const runEnvironments = RunEnvironmentsModule.register({
      imports: [work, projects],
      knownTasks: TaskService,
    });
    const pipelines = PipelinesModule.register({
      imports: [work, PeopleModule, engineCascade, conversations, projects, runEnvironments],
      startedTasks: TaskService,
      taskRecords: TaskRecords,
      knownPeople: RoleCards,
      projectDefaults: ProjectService,
      stageThreads: StageThreads,
      stageDecisions: StageDecisions,
      taskGit: TaskWorktrees,
      taskCommands: TaskWorktrees,
      taskPublishing: TaskWorktrees,
      taskScreenshots: StageScreenshots,
      taskUsage: TaskTokens,
      taskThreadSessions: ThreadRunner,
      proposalDrafts: ProposalService,
      stageRoleEngines: PipelineRoleCapabilityChecks,
      runEnvironmentDefinitions: RunEnvironmentDefinitions,
      pipelineInitiatives: InitiativeService,
    });
    return {
      module: AppModule,
      imports: [
        conversations,
        DatabaseModule.forRoot({ url: config.databaseUrl }),
        EngineAccountsModule,
        engineCascade,
        EngineModule,
        EventsModule,
        EventStreamModule,
        github,
        GitHubUserTokenModule.register({ imports: [github], gitHubUserToken: GitHubAccess }),
        HealthModule,
        McpServersModule,
        OfficeDataModule.forRoot(config.officeDataDirectory),
        OfficeIdentityHttpModule,
        OfficeUpdatesModule.register({
          checkout: officeCheckout,
          updateFolder: config.officeUpdateFolder,
        }),
        NotificationsModule.register({
          imports: [work, conversations, pipelines, PeopleModule, EngineModule],
          officeTasks: TaskService,
          openDecisions: DecisionService,
          taskStageProgress: TaskStagesService,
          deskLimit: OfficeLimits,
          startQueue: QueueService,
          knownPeople: RoleCards,
          accountUsage: UsageWindowState,
          officeStatusCards: ThreadService,
          officeFireAlarm: FireAlarmService,
          resumePlans: AlarmResumes,
        }),
        PeopleModule,
        pipelines,
        projects,
        runEnvironments,
        SkillsModule,
        TelemetryModule,
        WebAppModule.register(webApp),
        work,
        WorkstationModule,
      ],
    };
  }
}
