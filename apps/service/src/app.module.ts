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
import { EngineModule, ModelPrices, UsageWindowState } from "./modules/engine/index.js";
import { GitHubAccess, GitHubModule } from "./modules/github/index.js";
import { NotificationsModule } from "./modules/notifications/index.js";
import { PeopleModule, RoleCards } from "./modules/people/index.js";
import {
  AlarmResumes,
  PipelineLibrary,
  PipelineLibraryModule,
  PipelinesModule,
  TaskStagesService,
  UsageHistory,
  UsageHistoryModule,
} from "./modules/pipelines/index.js";
import {
  BaseCheckouts,
  ProjectService,
  ProjectsFromRepositories,
  ProjectsModule,
  TaskWorktrees,
} from "./modules/projects/index.js";
import { McpServersModule } from "./modules/mcp-servers/index.js";
import { SkillsModule } from "./modules/skills/index.js";
import {
  FireAlarmService,
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

@Module({})
export class AppModule {
  static register(config: OfficeConfig, webApp: WebAppOptions): DynamicModule {
    // One instance, so every token read goes through the same sign-in changes and refreshes once.
    const github = GitHubModule.register({ web: config.gitHub.webUrl, api: config.gitHub.apiUrl });
    // One instance, so every git change on a repository goes through the same locks.
    const projects = ProjectsModule.register({
      imports: [PipelineLibraryModule, github],
      knownPipelines: PipelineLibrary,
    });
    const conversations = ConversationsModule.register({
      imports: [projects],
      projectBases: BaseCheckouts,
    });
    const work = WorkModule.register({
      imports: [projects, conversations, PeopleModule, PipelineLibraryModule, UsageHistoryModule],
      knownProjects: ProjectService,
      newProjects: ProjectsFromRepositories,
      projectWorktrees: TaskWorktrees,
      knownPeople: RoleCards,
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
      modelPrices: ModelPrices,
      accountWindows: UsageWindowState,
    });
    const pipelines = PipelinesModule.register({
      imports: [work, PeopleModule, conversations, projects],
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
    });
    return {
      module: AppModule,
      imports: [
        conversations,
        DatabaseModule.forRoot({ url: config.databaseUrl }),
        EngineModule,
        EventsModule,
        EventStreamModule,
        github,
        GitHubUserTokenModule.register({ imports: [github], gitHubUserToken: GitHubAccess }),
        HealthModule,
        McpServersModule,
        OfficeDataModule.forRoot(config.officeDataDirectory),
        OfficeIdentityHttpModule,
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
        SkillsModule,
        TelemetryModule,
        WebAppModule.register(webApp),
        work,
      ],
    };
  }
}
