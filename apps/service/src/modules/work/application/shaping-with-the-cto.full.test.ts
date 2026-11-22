import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Injectable, Module, type INestApplication } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { ScheduleModule } from "../../../platform/schedule/schedule.module.js";
import { OfficeDataModule } from "../../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../platform/websocket/event-stream.module.js";
import {
  ConversationsModule,
  DecisionService,
  LIST_PIPELINES_TOOL,
  LIST_STAGE_TEMPLATES_TOOL,
  ProposalService,
  ThreadRunner,
  ThreadService,
} from "../../conversations/index.js";
import {
  EngineModule,
  OfficeToolRegistry,
  ScriptedEngine,
  ScriptedEngineModule,
  type SessionScript,
} from "../../engine/index.js";
import {
  EngineCascade,
  MemoryService,
  PeopleModule,
  RoleCards,
  type SessionRole,
} from "../../people/index.js";
import { EngineCascadeStandIn } from "../../people/index.fixtures.js";
import { PipelineLibrary, PipelineLibraryModule } from "../../pipelines/index.js";
import {
  IssueTasks,
  IssueWriteBack,
  ProjectService,
  TaskBases,
  TestTargets,
} from "../../projects/index.js";
import type { Initiative } from "../domain/initiative.js";
import {
  KnownProjectsForTests,
  KnownEngineCascadeForTests,
  NewProjectsForTests,
  AccountWindowsForTests,
  AccountWindowRatiosForTests,
  DayUsageForTests,
  TaskTokensForTests,
  ModelPricesForTests,
  ProjectInitiativeBranchesForTests,
  ProjectBranchDeletionsForTests,
  ProjectWorktreesForTests,
  TaskPullRequestsForTests,
  StageResultsForTests,
  TaskGatesForTests,
  TaskBasesForTests,
  IssueWriteBackForTests,
  UsageHistoryForTests,
} from "../ports/work-ports.fixtures.js";
import { ADD_TASK, WRITE_OUTCOME } from "../adapters/office-tools/shaping-office-tools.js";
import { WorkModule } from "../work.module.js";
import { ownProjectsQueue } from "../adapters/postgres/postgres-queue-repository.fixtures.js";
import { IdeaService } from "./idea-service.js";
import { InitiativeService } from "./initiative-service.js";
import { MCP_TOOL_DEFAULT_STAND_IN } from "../../people/index.fixtures.js";
import { ANN_LEE } from "../domain/work.fixtures.js";
import { ANN_LEE as ANN_LEE_USER } from "../../conversations/index.fixtures.js";

/** The Role holding Shapes Initiatives by default. */
const CTO = "cto";

type Step = SessionScript[number];

/** A Project id of this file's own: every test file shares the database. */
const PROJECT = "shaping-with-the-cto";
const USAGE = { input: 3, output: 120, cacheRead: 0, cacheCreation: 26_000 };

/** The CTO, whose key only roles.controller.test may hire into: People's RoleCards stand in. */
const CTO_ROLE: SessionRole = {
  roleKey: CTO,
  cardVersion: 1,
  mcpToolDefault: MCP_TOOL_DEFAULT_STAND_IN,
  card: {
    name: "Bob",
    title: "CTO",
    responsibilities: "Shapes Initiatives across Projects with you.",
    instructions: "Agree the outcome first, then the Tasks.",
    roleOverride: null,
    effort: "low",
    capabilities: { sharedMemory: true, chat: true, consultant: true, runEnvironment: false },
    permissionProfile: { edit: false, run: "read-only-git", web: true, mcpTools: {} },
    hardSwitches: {
      runInstalls: { kind: "consult", role: "devops" },
      publishOutsideThePipeline: { kind: "ask-me" },
      changeRoles: { kind: "never" },
    },
    taskLimit: 2,
    sessionDefault: "context-policy",
  },
};

@Injectable()
class CtoOnly {
  async find(roleKey: string): Promise<SessionRole | undefined> {
    return roleKey === CTO ? CTO_ROLE : undefined;
  }

  async forNewSession(): Promise<SessionRole> {
    return CTO_ROLE;
  }

  async forResumedSession(): Promise<SessionRole> {
    return CTO_ROLE;
  }

  async hiredKeys(): Promise<ReadonlySet<string>> {
    return new Set([CTO]);
  }

  /** The CTO holds Shapes Initiatives, and nobody any other duty. */
  async holderOf(duty: string): Promise<string | undefined> {
    return duty === "shapes-initiatives" ? CTO : undefined;
  }

  async dutyHolders(): Promise<ReadonlyMap<string, string>> {
    return new Map([["shapes-initiatives", CTO]]);
  }

  async consultants(): Promise<readonly never[]> {
    return [];
  }
}

/** The CTO's Memory, which People keeps by the hired Role: nothing in it yet. */
const NO_MEMORY: Pick<MemoryService, "read"> = {
  read: () => Promise.resolve({ inUse: true, notes: [] }),
};

/** No Project's base is checked out: the session reads none. */
@Injectable()
class NoProjectBases {
  readonly folder = tmpdir();

  async list(): Promise<readonly never[]> {
    return [];
  }

  async refresh(): Promise<readonly never[]> {
    return [];
  }

  initiativeFolder(shortName: string): string {
    return join(tmpdir(), "initiative-bases", shortName);
  }

  async listOnInitiative(): Promise<readonly never[]> {
    return [];
  }

  async refreshOnInitiative(): Promise<readonly never[]> {
    return [];
  }
}

/** No Project has Secret variables: what a session writes is kept as it is. */
@Injectable()
class NoProjectOutputMasks {
  outputMaskOf(): Promise<{ mask: (text: string) => string }> {
    return Promise.resolve({ mask: (text) => text });
  }
}

class NoProjectRecords {
  of(): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }
}

/**
 * Projects' list_projects and Pipelines' list_pipelines and list_stage_templates, which a shaping
 * session is given, on the registry the sessions read.
 */
@Injectable()
class ListProjectsStandIn {
  constructor(registry: OfficeToolRegistry) {
    registry.register({
      name: "list_projects",
      description: "Lists the Projects.",
      input: z.object({}),
      run: () => Promise.resolve({ text: PROJECT, isError: false }),
    });
    for (const name of [LIST_PIPELINES_TOOL, LIST_STAGE_TEMPLATES_TOOL]) {
      registry.register({
        name,
        description: `Stands in for ${name}.`,
        input: z.object({}),
        run: () => Promise.resolve({ text: "Nothing.", isError: false }),
      });
    }
  }
}

const STAND_INS = [
  NoProjectBases,
  NoProjectOutputMasks,
  NoProjectRecords,
  KnownProjectsForTests,
  KnownEngineCascadeForTests,
  NewProjectsForTests,
  ProjectWorktreesForTests,
  TaskPullRequestsForTests,
  ProjectInitiativeBranchesForTests,
  ProjectBranchDeletionsForTests,
  StageResultsForTests,
  TaskGatesForTests,
  UsageHistoryForTests,
  ModelPricesForTests,
  AccountWindowsForTests,
  AccountWindowRatiosForTests,
  DayUsageForTests,
  TaskTokensForTests,
  TaskBasesForTests,
  { provide: TaskBases, useExisting: TaskBasesForTests },
  IssueTasks,
  IssueWriteBackForTests,
  { provide: IssueWriteBack, useExisting: IssueWriteBackForTests },
];

/** Projects' service, which Conversations judges Devops' Proposals by; none is drafted here. */
const NO_PROJECT_SERVICE = { provide: ProjectService, useValue: {} };

/** Projects' test targets, which Conversations judges their Proposals by; none is drafted here. */
const NO_TEST_TARGETS = { provide: TestTargets, useValue: {} };

const ENGINE_CASCADE = { provide: EngineCascade, useValue: new EngineCascadeStandIn() };

@Module({
  imports: [EngineModule],
  providers: [
    ...STAND_INS,
    NO_PROJECT_SERVICE,
    NO_TEST_TARGETS,
    ENGINE_CASCADE,
    ListProjectsStandIn,
  ],
  exports: [...STAND_INS, ProjectService, TestTargets, EngineCascade],
})
class StandInsModule {}

let officeData: string;
let app: INestApplication;
let engine: ScriptedEngine;

beforeEach(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-shaping-cto-"));
});

afterEach(async () => {
  await app.close();
  await rm(officeData, { recursive: true, force: true });
});

/** Boots Work and Conversations on a scripted engine that replays `scripts`. */
async function startWith(...scripts: SessionScript[]): Promise<void> {
  engine = new ScriptedEngine(scripts);
  const conversations = ConversationsModule.register({
    imports: [StandInsModule],
    projectBases: NoProjectBases,
    projectOutputMasks: NoProjectOutputMasks,
    projectRecords: NoProjectRecords,
  });
  ({ app } = await startTestApplication({
    database: true,
    imports: [
      EventsModule,
      ScheduleModule,
      EventStreamModule,
      TelemetryModule,
      OfficeDataModule.forRoot(officeData),
      EngineModule,
      PeopleModule,
      PipelineLibraryModule,
      conversations,
      WorkModule.register({
        imports: [StandInsModule, conversations, PeopleModule, PipelineLibraryModule],
        knownProjects: KnownProjectsForTests,
        newProjects: NewProjectsForTests,
        projectWorktrees: ProjectWorktreesForTests,
        taskPullRequests: TaskPullRequestsForTests,
        projectInitiativeBranches: ProjectInitiativeBranchesForTests,
        projectBranchDeletions: ProjectBranchDeletionsForTests,
        knownPeople: RoleCards,
        knownEngineCascade: KnownEngineCascadeForTests,
        knownPipelines: PipelineLibrary,
        sessionPeople: ThreadService,
        ideaCards: ThreadService,
        sessionTasks: ThreadService,
        sessionInitiatives: ThreadService,
        taskThreads: ThreadService,
        initiativeThreads: ThreadService,
        taskDecisions: DecisionService,
        proposalDrafts: ProposalService,
        usageHistory: UsageHistoryForTests,
        stageResults: StageResultsForTests,
        taskGates: TaskGatesForTests,
        modelPrices: ModelPricesForTests,
        accountWindows: AccountWindowsForTests,
        accountWindowRatios: AccountWindowRatiosForTests,
        dayUsage: DayUsageForTests,
        taskTokens: TaskTokensForTests,
      }),
    ],
    overrides: [
      { provide: RoleCards, useValue: new CtoOnly() },
      { provide: MemoryService, useValue: NO_MEMORY },
      ownProjectsQueue(),
    ],
    moduleOverrides: [{ module: EngineModule, useModule: ScriptedEngineModule.register(engine) }],
  }));
}

/** The CTO calls each Office tool in turn, then ends the turn on the message `consumed`. */
function turn(consumed: string, calls: readonly [string, Record<string, unknown>][]): Step[] {
  return [
    ...calls.flatMap(([tool, input], index): Step[] => [
      {
        step: "event",
        event: {
          kind: "tool-call",
          callId: `${consumed}-${index}`,
          tool,
          officeTool: true,
          input,
          withinToolCall: undefined,
        },
      },
      {
        step: "event",
        event: {
          kind: "tool-result",
          callId: `${consumed}-${index}`,
          text: "",
          isError: false,
          withinToolCall: undefined,
        },
      },
    ]),
    { step: "event", event: { kind: "text", text: "Done.", withinToolCall: undefined } },
    {
      step: "event",
      event: {
        kind: "turn-ended",
        outcome: "completed",
        consumedMessageIds: [consumed],
        usage: USAGE,
        sessionCostUsd: 0.01,
        output: undefined,
        errors: [],
      },
    },
    { step: "read-context-usage", usage: { tokens: 32_000, window: 1_000_000 } },
  ];
}

async function shapeAnIdea(): Promise<Initiative> {
  const idea = await app
    .get(IdeaService)
    .capture({ title: "Offline sync", notes: "", projectId: undefined }, ANN_LEE);
  return app.get(InitiativeService).shape(idea.id, ANN_LEE);
}

/** The Initiative's one shaping Thread, once the CTO has ended `turns` turns in it. */
async function shapingThreadOnceAnswered(initiativeId: string, turns: number): Promise<string> {
  return vi.waitFor(
    async () => {
      const ended = engine.sessions
        .flatMap((session) => session.reportedEvents)
        .filter((event) => event.kind === "turn-ended");
      const [thread] = await app.get(ThreadService).listOnInitiative(initiativeId);
      if (!thread || ended.length < turns || thread.state !== "waiting") {
        throw new Error("Still answering.");
      }
      return thread.id;
    },
    { timeout: 5_000, interval: 20 },
  );
}

/** Every Office tool result the CTO read, in order. */
function toolResults(): { readonly text: string; readonly isError: boolean }[] {
  return engine.sessions
    .flatMap((session) => session.reportedEvents)
    .flatMap((event) =>
      event.kind === "tool-result" ? [{ text: event.text, isError: event.isError }] : [],
    );
}

describe("shaping an Initiative with the CTO", () => {
  it("writes straight onto it while shaping, then drafts a Proposal the user applies once it is active", async () => {
    await startWith([
      { step: "start", brief: { id: "brief", text: "" } },
      ...turn("brief", [
        [WRITE_OUTCOME, { outcome: "Writes made offline reach the server." }],
        [ADD_TASK, { title: "Queue writes", projectId: PROJECT }],
      ]),
      { step: "send", message: { id: "after-confirm", text: "" }, priority: "later" },
      ...turn("after-confirm", [[WRITE_OUTCOME, { outcome: "Writes made offline sync." }]]),
    ]);
    const initiatives = app.get(InitiativeService);

    const shaped = await shapeAnIdea();
    const threadId = await shapingThreadOnceAnswered(shaped.id, 1);

    const whileShaping = await initiatives.read(shaped.id);
    expect(whileShaping.outcome).toBe("Writes made offline reach the server.");
    const [task] = (await initiatives.tasksByInitiative()).get(shaped.id) ?? [];
    expect(task).toMatchObject({
      title: "Queue writes",
      projectId: PROJECT,
      createdBy: { kind: "person", roleKey: CTO },
    });

    await initiatives.confirm(shaped.id, ANN_LEE);
    await app.get(ThreadRunner).send(threadId, "Make the outcome shorter.", ANN_LEE_USER);
    await shapingThreadOnceAnswered(shaped.id, 2);
    const proposals = app.get(ProposalService);
    const [proposal] = await proposals.listInThread(threadId);

    expect(toolResults().map(({ isError }) => isError)).toEqual([false, false, false]);
    expect((await initiatives.read(shaped.id)).outcome).toBe(
      "Writes made offline reach the server.",
    );
    expect(proposal).toMatchObject({
      draftedBy: CTO,
      change: {
        kind: "initiative",
        initiativeId: shaped.id,
        edit: { kind: "outcome", outcome: "Writes made offline sync." },
      },
      status: { kind: "open" },
    });

    await proposals.apply(proposal?.id ?? "", ANN_LEE_USER);

    expect((await initiatives.read(shaped.id)).outcome).toBe("Writes made offline sync.");
  });
});
