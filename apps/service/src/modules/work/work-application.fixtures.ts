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
  ProjectWorktreesForTests,
  SessionInitiativesForTests,
  SessionPeopleForTests,
  SessionTasksForTests,
  TaskDecisionsForTests,
  TaskThreadsForTests,
  StageResultsForTests,
  UsageHistoryForTests,
  WorkPortsForTestsModule,
} from "./ports/work-ports.fixtures.js";
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
): Promise<WorkApplication> {
  const { app, url } = await startTestApplication({
    database: true,
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
  return { app, url, published };
}

/** Work on the test ports, every Project known but UNKNOWN_PROJECT, and the library's Pipelines. */
export function workModuleForTests(): DynamicModule {
  return WorkModule.register({
    imports: [WorkPortsForTestsModule, PipelineLibraryModule],
    knownProjects: KnownProjectsForTests,
    newProjects: NewProjectsForTests,
    projectWorktrees: ProjectWorktreesForTests,
    knownPeople: KnownPeopleForTests,
    knownEngineCascade: KnownEngineCascadeForTests,
    knownPipelines: PipelineLibrary,
    sessionPeople: SessionPeopleForTests,
    ideaCards: IdeaCardsForTests,
    sessionTasks: SessionTasksForTests,
    sessionInitiatives: SessionInitiativesForTests,
    taskThreads: TaskThreadsForTests,
    initiativeThreads: InitiativeThreadsForTests,
    taskDecisions: TaskDecisionsForTests,
    proposalDrafts: ProposalDraftsForTests,
    usageHistory: UsageHistoryForTests,
    stageResults: StageResultsForTests,
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
  return published.map((event) => {
    const { occurredAt: _occurredAt, ...webEvent } = workWebEventSchema.parse(
      forwarding.toWebEvent(event),
    );
    return webEvent;
  });
}

/** A JSON request to the application's API. */
export function sendJson(
  { url }: WorkApplication,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<Response> {
  const init: RequestInit =
    body === undefined
      ? { method }
      : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  return fetch(`${url}/api${path}`, init);
}
