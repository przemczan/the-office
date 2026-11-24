import type { DynamicModule, INestApplication } from "@nestjs/common";
import { workWebEventSchema } from "@the-office/contracts";
import { startTestApplication, type ProviderOverride } from "../../../test/test-application.js";
import { PipelineLibrary, PipelineLibraryModule } from "../pipelines/index.js";
import type { DomainEvent } from "../../platform/events/domain-event.js";
import { EventBus } from "../../platform/events/event-bus.js";
import { EventsModule } from "../../platform/events/events.module.js";
import { OfficeDataModule } from "../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../platform/websocket/event-stream.module.js";
import { WebEventForwarding } from "../../platform/websocket/web-event-forwarding.js";
import {
  IdeaCardsForTests,
  InitiativeThreadsForTests,
  KnownEngineCascadeForTests,
  KnownPeopleForTests,
  KnownProjectsForTests,
  AccountWindowsForTests,
  AccountWindowRatiosForTests,
  DayUsageForTests,
  TaskTokensForTests,
  ModelPricesForTests,
  NewProjectsForTests,
  ProposalDraftsForTests,
  ProjectInitiativeBranchesForTests,
  ProjectBranchDeletionsForTests,
  ProjectWorktreesForTests,
  TaskPullRequestsForTests,
  SessionInitiativesForTests,
  SessionPeopleForTests,
  SessionTasksForTests,
  TaskDecisionsForTests,
  TaskThreadsForTests,
  ThreadTurnsForTests,
  StageResultsForTests,
  TaskGatesForTests,
  UsageHistoryForTests,
  WorkPortsForTestsModule,
} from "./ports/work-ports.fixtures.js";
import { TaskStageEdits } from "./application/task-stage-edits.js";
import { TaskStartOvers, type StartOverWork } from "./application/task-start-overs.js";
import { WorkModule } from "./work.module.js";
import { ownProjectsQueue } from "./adapters/postgres/postgres-queue-repository.fixtures.js";

/** The Work module served over HTTP on the test database, with every event it publishes. */
export interface WorkApplication {
  readonly app: INestApplication;
  readonly url: string;
  /** The events published since the application started or `published.length = 0`. */
  readonly published: DomainEvent[];
}

/**
 * Every Project is known but UNKNOWN_PROJECT, and the Pipelines are the library's; files go into
 * `officeDataFolder`.
 */
export async function startWorkApplication(
  officeDataFolder: string,
  overrides: readonly ProviderOverride[] = [],
  databaseUrl?: string,
): Promise<WorkApplication> {
  const { app, url } = await startTestApplication({
    database: databaseUrl === undefined ? true : { url: databaseUrl },
    // No Projects of its own by default: a test that queues Tasks names its own in `overrides`.
    overrides: [ownProjectsQueue(), ...overrides],
    imports: [
      EventsModule,
      EventStreamModule,
      TelemetryModule,
      OfficeDataModule.forRoot(officeDataFolder),
      workModuleForTests(),
    ],
  });
  const published: DomainEvent[] = [];
  app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
  // Pipelines isn't here to say: no Task's Stages are edited unless a test registers its own.
  app.get(TaskStageEdits).register(async () => false);
  // Nor to start a Task's work over: nothing refuses, no Task had started, and no branch is reset.
  app.get(TaskStartOvers).register(START_OVER_WORK_FOR_TESTS);
  return { app, url, published };
}

/** Pipelines' part of a Start over as a Work application without Pipelines has it. */
export const START_OVER_WORK_FOR_TESTS: StartOverWork = {
  refusals: async () => [],
  resetTo: async () => "main",
  hadStarted: async () => false,
  startOver: async () => ({ resetTo: undefined, keptRef: undefined }),
};

/** Work on the test ports, every Project known but UNKNOWN_PROJECT, and the library's Pipelines. */
export function workModuleForTests(): DynamicModule {
  return WorkModule.register({
    imports: [WorkPortsForTestsModule, PipelineLibraryModule],
    knownProjects: KnownProjectsForTests,
    newProjects: NewProjectsForTests,
    projectWorktrees: ProjectWorktreesForTests,
    taskPullRequests: TaskPullRequestsForTests,
    projectInitiativeBranches: ProjectInitiativeBranchesForTests,
    projectBranchDeletions: ProjectBranchDeletionsForTests,
    knownPeople: KnownPeopleForTests,
    knownEngineCascade: KnownEngineCascadeForTests,
    knownPipelines: PipelineLibrary,
    sessionPeople: SessionPeopleForTests,
    ideaCards: IdeaCardsForTests,
    sessionTasks: SessionTasksForTests,
    sessionInitiatives: SessionInitiativesForTests,
    taskThreads: TaskThreadsForTests,
    initiativeThreads: InitiativeThreadsForTests,
    threadTurns: ThreadTurnsForTests,
    taskDecisions: TaskDecisionsForTests,
    proposalDrafts: ProposalDraftsForTests,
    usageHistory: UsageHistoryForTests,
    stageResults: StageResultsForTests,
    taskGates: TaskGatesForTests,
    modelPrices: ModelPricesForTests,
    accountWindows: AccountWindowsForTests,
    accountWindowRatios: AccountWindowRatiosForTests,
    dayUsage: DayUsageForTests,
    taskTokens: TaskTokensForTests,
  });
}

/** The events published, as the web receives them, without their times. */
export function webEventsOf({ app, published }: WorkApplication): unknown[] {
  const forwarding = app.get(WebEventForwarding);
  // An event with no web form, such as one a background reaction publishes late, never reaches it.
  return published.flatMap((event) => {
    const forwarded = forwarding.toWebEvent(event);
    if (forwarded === undefined) return [];
    const { occurredAt: _occurredAt, ...webEvent } = workWebEventSchema.parse(forwarded);
    return [webEvent];
  });
}

/**
 * A JSON request to the application's API, signed in as `SIGNED_IN_FOR_TESTS` unless `headers`
 * name another user (`signedInAs`).
 */
export function sendJson(
  { url }: WorkApplication,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
  headers: Readonly<Record<string, string>> = {},
): Promise<Response> {
  const init: RequestInit =
    body === undefined
      ? { method, headers }
      : {
          method,
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        };
  return fetch(`${url}/api${path}`, init);
}
