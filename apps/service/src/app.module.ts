import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Module, type DynamicModule } from "@nestjs/common";
import { ActionRuns, ActionsModule } from "./modules/actions/index.js";
import { ActivityModule } from "./modules/activity/index.js";
import {
  ActivitySessions,
  ConsultationsOnTasks,
  ContextPolicySettingsService,
  ConversationsModule,
  DecisionService,
  ProposalService,
  SessionThreads,
  StageDecisions,
  StageThreadMessages,
  StageThreads,
  TaskTokens,
  ThreadCards,
  ThreadRunner,
  ThreadsAtWork,
  WaitingOnTheUser,
  WorkThreads,
} from "./modules/conversations/index.js";
import {
  DayUsage,
  EngineAccountsModule,
  EngineModule,
  ModelPrices,
  UsageWindowSamples,
  UsageWindowsNow,
  UsageWindowState,
} from "./modules/engine/index.js";
import { GitHubAccess, GitHubModule } from "./modules/github/index.js";
import {
  DayFigures,
  DayFiguresModule,
  DayTokenHistory,
  NotificationsModule,
} from "./modules/notifications/index.js";
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
  RunningStageRuns,
  StageRunEngines,
  StageRunsRunningNow,
  TaskStagesService,
  StageResultWords,
  StageRunTotals,
  StandInChoices,
  TaskGateRuns,
  UsageHistory,
  UsageHistoryModule,
} from "./modules/pipelines/index.js";
import {
  BaseCheckouts,
  BranchDeletions,
  CiRunWatch,
  EngineLevelsChecks,
  EnvironmentChecks,
  InitiativeBranches,
  ProjectRecords,
  ProjectService,
  ProjectsFromRepositories,
  ProjectsModule,
  PullRequestRecords,
  TaskWorktrees,
} from "./modules/projects/index.js";
import { McpServerOfficeActionsModule, McpServersModule } from "./modules/mcp-servers/index.js";
import { ConnectedDevices, DevicesModule } from "./modules/devices/index.js";
import {
  RunEnvironmentDefinitions,
  RunEnvironmentsModule,
} from "./modules/run-environments/index.js";
import { OfficeUpdates, OfficeUpdatesModule } from "./modules/office-updates/index.js";
import { PromptTemplatesModule } from "./modules/prompt-templates/index.js";
import { SkillLibrary, SkillsModule } from "./modules/skills/index.js";
import { GrafanaStatsSource, StatsModule } from "./modules/telemetry/index.js";
import { TestInstances, TestInstancesModule } from "./modules/test-instances/index.js";
import {
  CookieSignedInRequests,
  GitHubIdentityProvider,
  GoogleIdentityProvider,
  OpenIdConnectIdentityProvider,
  Users,
  UsersModule,
} from "./modules/users/index.js";
import {
  ConversationsThreadTurns,
  FireAlarmService,
  InitiativeService,
  OffBoardTaskReader,
  OfficeLimits,
  QueueService,
  StageScreenshots,
  TaskRecords,
  TaskService,
  WorkEngineLevels,
  WorkEngineLevelsModule,
  WorkModule,
} from "./modules/work/index.js";
import {
  GitHubUserTokenModule,
  OfficeIdentityHttpModule,
} from "./modules/office-identity/index.js";
import { WorkstationFigureModule } from "./modules/workstation/index.js";
import type { OfficeConfig } from "./platform/config/office-config.js";
import { DatabaseModule } from "./platform/database/database.module.js";
import { EarlierRecordsModule } from "./platform/earlier-records/earlier-records.module.js";
import { KnowledgeBaseModule } from "./platform/knowledge-base/knowledge-base.module.js";
import { EventsModule } from "./platform/events/events.module.js";
import { HealthModule } from "./platform/health/health.module.js";
import { OfficeReachModule } from "./platform/office-reach/office-reach.module.js";
import { OfficeTestInstanceModule } from "./platform/test-instance/office-test-instance.module.js";
import { RequestAccessModule } from "./platform/http/request-access.module.js";
import { OfficeDataModule } from "./platform/office-data/office-data.module.js";
import { SystemHealthRecorder } from "./platform/system-health/system-health-recorder.js";
import { SystemHealthModule } from "./platform/system-health/system-health.module.js";
import { SystemHealthMetricsModule } from "./platform/telemetry/system-health-metrics.module.js";
import { TelemetrySettingModule } from "./platform/telemetry/telemetry-setting.module.js";
import { TelemetryModule } from "./platform/telemetry/telemetry.module.js";
import { WebAppModule, type WebAppOptions } from "./platform/web-app/web-app.module.js";
import { EventStream } from "./platform/websocket/event-stream.js";
import { EventStreamModule } from "./platform/websocket/event-stream.module.js";

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
    // One instance, so the guard and the sign-in pages share the same signed-in devices and trips.
    const users = UsersModule.register({
      imports: [github],
      identityProviders: [
        GitHubIdentityProvider,
        GoogleIdentityProvider,
        OpenIdConnectIdentityProvider,
      ],
      skipSetupBasics: config.skipSetupBasics ?? false,
    });
    // One instance, so every git change on a repository goes through the same locks.
    const projects = ProjectsModule.register({
      imports: [PipelineLibraryModule, github],
      knownPipelines: PipelineLibrary,
    });
    const engineCascade = EngineCascadeModule.register({
      imports: [projects, PipelineLibraryModule, WorkEngineLevelsModule],
      knownProjectLevels: ProjectService,
      knownWorkLevels: WorkEngineLevels,
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
        DayFiguresModule,
      ],
      knownProjects: ProjectService,
      newProjects: ProjectsFromRepositories,
      projectWorktrees: TaskWorktrees,
      taskPullRequests: PullRequestRecords,
      projectInitiativeBranches: InitiativeBranches,
      projectBranchDeletions: BranchDeletions,
      knownPeople: RoleCards,
      knownEngineCascade: EngineCascade,
      knownPipelines: PipelineLibrary,
      sessionPeople: SessionThreads,
      ideaCards: ThreadCards,
      sessionTasks: SessionThreads,
      sessionInitiatives: SessionThreads,
      taskThreads: WorkThreads,
      initiativeThreads: WorkThreads,
      threadTurns: ConversationsThreadTurns,
      taskDecisions: DecisionService,
      proposalDrafts: ProposalService,
      usageHistory: UsageHistory,
      stageResults: StageResultWords,
      taskGates: TaskGateRuns,
      modelPrices: ModelPrices,
      accountWindows: UsageWindowState,
      accountWindowRatios: UsageWindowSamples,
      dayUsage: DayUsage,
      dayOutcomes: DayFigures,
      taskTokens: TaskTokens,
    });
    // Work's Tasks tell the startup sweep which run environments to keep; a Project's Run
    // environment setting is kept by Projects, and its set-up Task by Work. The release carries
    // the device helper's build where a checkout's `npm run build:device-helper` writes it. A
    // person's name and title, which a set-up records, come from People's Role cards.
    const runEnvironments = RunEnvironmentsModule.register({
      imports: [work, projects, PeopleModule],
      knownTasks: TaskService,
      knownPeople: RoleCards,
      deviceHelperSource: join(officeCheckout, "tools", "device-helper", "dist"),
    });
    const pipelines = PipelinesModule.register({
      imports: [work, PeopleModule, engineCascade, conversations, projects, runEnvironments],
      startedTasks: TaskService,
      taskRecords: TaskRecords,
      knownPeople: RoleCards,
      projectDefaults: ProjectService,
      stageThreads: StageThreads,
      stageThreadMessages: StageThreadMessages,
      stageDecisions: StageDecisions,
      taskGit: TaskWorktrees,
      taskCommands: TaskWorktrees,
      taskPublishing: TaskWorktrees,
      taskScreenshots: StageScreenshots,
      taskUsage: TaskTokens,
      stageContextLimitDefaults: ContextPolicySettingsService,
      taskThreadSessions: ThreadRunner,
      sessionPeople: SessionThreads,
      stageRoleEngines: PipelineRoleCapabilityChecks,
      roleEngineCascade: EngineCascade,
      runEnvironmentDefinitions: RunEnvironmentDefinitions,
      taskConsultations: ConsultationsOnTasks,
      pipelineInitiatives: InitiativeService,
    });
    // One instance, so Now and Settings › Updates read the same update found.
    const officeUpdates = OfficeUpdatesModule.register({
      checkout: officeCheckout,
      updateFolder: config.officeUpdateFolder,
      install: config.officeInstall,
      officeDataDirectory: config.officeDataDirectory,
      gitHubApiUrl: config.gitHub.apiUrl,
    });
    // One instance, so Stats reads the same day figures Now counts.
    const notifications = NotificationsModule.register({
      imports: [
        work,
        conversations,
        pipelines,
        PeopleModule,
        EngineModule,
        projects,
        SkillsModule,
        officeUpdates,
        users,
      ],
      officeTasks: TaskService,
      officeInitiatives: InitiativeService,
      taskStageProgress: TaskStagesService,
      deskLimit: OfficeLimits,
      startQueue: QueueService,
      knownPeople: RoleCards,
      accountUsage: UsageWindowState,
      officeStatusCards: ThreadCards,
      officeFireAlarm: FireAlarmService,
      resumePlans: AlarmResumes,
      standInChoicesWaiting: StandInChoices,
      pullRequestsWaiting: PullRequestRecords,
      skillUpdatesFound: SkillLibrary,
      officeUpdateAvailable: OfficeUpdates,
      waitingInConversations: WaitingOnTheUser,
      officeUsers: Users,
      officeOffBoardTasks: OffBoardTaskReader,
    });
    // Work's Tasks and the run environments their devices are relayed into.
    const devices = DevicesModule.register({
      imports: [work, projects, runEnvironments, conversations],
      sessionPeople: SessionThreads,
    });
    // Initiatives' branches from Work, test targets and checkouts from Projects, Hosted instances
    // and install environments from Run environments, which take no run environment slot, and the
    // Project devices an Install on a device holds from Devices.
    const testInstances = TestInstancesModule.register({
      imports: [work, projects, runEnvironments, devices, conversations],
      officePort: config.port,
      officeHost: config.host,
      sessionPeople: SessionThreads,
    });
    // Action runs: Projects' Actions, checkouts and code host, Run environments' command runs,
    // Test instances' launches, Devices' Project devices held by a run and Work's Tasks,
    // Initiatives and fire alarm.
    const actions = ActionsModule.register({
      imports: [work, projects, runEnvironments, testInstances, devices],
    });
    return {
      module: AppModule,
      imports: [
        actions,
        ActivityModule.register({
          imports: [work, pipelines, conversations, testInstances, actions, projects, devices],
          tasks: TaskService,
          initiatives: InitiativeService,
          sessions: ActivitySessions,
          stages: TaskStagesService,
          decisions: DecisionService,
          offBoardTasks: OffBoardTaskReader,
          testInstances: TestInstances,
          actionRuns: ActionRuns,
          ciRuns: CiRunWatch,
          environmentChecks: EnvironmentChecks,
          devices: ConnectedDevices,
        }),
        conversations,
        DatabaseModule.forRoot({ url: config.databaseUrl }),
        devices,
        EarlierRecordsModule,
        EngineAccountsModule,
        engineCascade,
        EngineModule,
        EventsModule,
        EventStreamModule,
        github,
        KnowledgeBaseModule,
        GitHubUserTokenModule.register({ imports: [github], gitHubUserToken: GitHubAccess }),
        HealthModule,
        McpServersModule,
        McpServerOfficeActionsModule,
        OfficeDataModule.forRoot(config.officeDataDirectory),
        OfficeTestInstanceModule.forRoot(config.testInstance ?? false),
        OfficeReachModule.forRoot(config.port, config.databaseUrl),
        OfficeIdentityHttpModule,
        officeUpdates,
        notifications,
        PeopleModule,
        pipelines,
        projects,
        PromptTemplatesModule,
        RequestAccessModule.register({
          publicAddress: config.publicAddress,
          imports: [users],
          signedInRequests: CookieSignedInRequests,
        }),
        runEnvironments,
        SkillsModule,
        StatsModule.register({
          imports: [
            notifications,
            EngineModule,
            UsageHistoryModule,
            work,
            projects,
            conversations,
            pipelines,
          ],
          dayTokens: DayTokenHistory,
          engineWindows: UsageWindowsNow,
          stageRunTotals: StageRunTotals,
          runningStageRuns: RunningStageRuns,
          stageRunEngines: StageRunEngines,
          officeTasks: TaskService,
          officeInitiatives: InitiativeService,
          projectNames: ProjectService,
          healthReadings: SystemHealthRecorder,
          sessionsRunning: ThreadsAtWork,
          stageRunsRunning: StageRunsRunningNow,
          browserConnections: EventStream,
          statsSource: GrafanaStatsSource,
        }),
        SystemHealthModule,
        SystemHealthMetricsModule,
        TelemetryModule,
        TelemetrySettingModule,
        testInstances,
        users,
        // Registering the GitHub App posts its manifest from the page to GitHub's website.
        WebAppModule.register({ ...webApp, formTargets: [new URL(config.gitHub.webUrl).origin] }),
        work,
        WorkstationFigureModule,
      ],
    };
  }
}
