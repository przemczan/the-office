import { randomInt, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { Logger, type INestApplication } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANSWER_DECISION_TOOL, OPEN_DECISION_TOOL } from "@the-office/contracts";
import { z } from "zod";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { Schedule } from "../../../platform/schedule/schedule.js";
import type { ManualSchedule } from "../../../platform/schedule/schedule.fixtures.js";
import { ScheduleModule } from "../../../platform/schedule/schedule.module.js";
import { OfficeDataModule } from "../../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../platform/websocket/event-stream.module.js";
import {
  EngineModels,
  FIRST_CLAUDE_CODE_ENGINE,
  OfficeToolRegistry,
  ScriptedEngine,
  ScriptedEngineModule,
  type SessionScript,
} from "../../engine/index.js";
import {
  apiEngineOnFakeServer,
  EngineSettingsForTests,
  textReply,
  type ApiEngineOnFakeServer,
  anOfficeToolCall,
} from "../../engine/index.fixtures.js";
import { BusyWork, BusyWorkModule } from "../../office-updates/index.js";
import { CARETAKER, EngineCascade, RoleCards, type SessionRole } from "../../people/index.js";
import { EngineCascadeStandIn } from "../../people/index.fixtures.js";
import { SessionMcpServers, type PreparedMcpServers } from "../../mcp-servers/index.js";
import { SessionSkills } from "../../skills/index.js";
import { DecisionOfficeTools } from "../adapters/office-tools/decision-office-tools.js";
import { PostgresThreadRepository } from "../adapters/postgres/postgres-thread-repository.js";
import {
  ALLOW_CHANGES_ADVICE,
  CALLING_RULE,
  CHANGE_ROLE_TOOL,
  CHAT_OFFICE_TOOLS,
  chatOfficeTools,
  CONSULT_TOOL,
  CREATE_INITIATIVE_TOOL,
  PROPOSE_OFFICE_SETUP_TOOL,
  HANDOVER_REQUEST,
  POST_LINK_CARD_TOOL,
  READ_REPOSITORY_TOOL,
} from "../domain/session-instructions.js";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import {
  ProcessOutputKept,
  SubAgentOrProcessChanged,
  TokensCounted,
  TurnEnded,
} from "../domain/conversation-events.js";
import type { ContextDecision } from "../domain/context-policy.js";
import type { BriefProject } from "../domain/brief.js";
import type { Message, MessageDraft } from "../domain/message.js";
import { NO_TOKENS, type Thread, type ThreadSession } from "../domain/thread.js";
import { aThread } from "../domain/thread.fixtures.js";
import { approvalQuestion, APPROVAL_OPTIONS } from "../domain/consult.js";
import type { Decision, DecisionKind } from "../domain/decision.js";
import { openDecision } from "../domain/thread-changes.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import { ProjectBases, type InitiativeBranchReads } from "../ports/project-bases.js";
import { projectBasesOver } from "../ports/project-bases.fixtures.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { Briefs } from "./briefs.js";
import { Consultations } from "./consultations.js";
import { FireAlarmInThreads } from "./fire-alarm-in-threads.js";
import { sessionMemoryProvider } from "./session-memory.fixtures.js";
import { DutiesStandIn, dutiesProvider } from "./duties.fixtures.js";
import { DecisionService } from "./decision-service.js";
import { InitiativeThreadSetups } from "./initiative-thread-setups.js";
import { InterruptedAnswers } from "./interrupted-answers.js";
import type { SessionEvent } from "./session-log.js";
import { aPlannerCard } from "./session-role.fixtures.js";
import { SessionPlaces } from "./session-places.js";
import { SESSION_START_SILENCE_MS } from "./session-start-watch.js";
import { CallChains } from "./call-chains.js";
import { TaskThreadSetups, type TaskThreadSetup } from "./task-thread-setups.js";
import { TaskTokens } from "./task-tokens.js";
import { ThreadContexts } from "./thread-contexts.js";
import { AllowChanges } from "./allow-changes.js";
import { StageThreads } from "./stage-threads.js";
import { ThreadRunner } from "./thread-runner.js";
import { MentionedRecords } from "./mentioned-records.js";
import { openPageRecordProviders } from "./open-page-records.fixtures.js";
import { WorkRecords } from "./work-records.js";
import { ThreadService } from "./thread-service.js";
import { ContextPolicySettingsService } from "./context-policy-settings.js";
import { ConversationsSettings } from "../ports/conversations-settings.js";
import { storedBeforeOfficeInstructions } from "../domain/thread.fixtures.js";
import { ConversationsSettingsForTests } from "../ports/conversations-settings.fixtures.js";
import { OfficeInstructionsRepositoryForTests } from "../ports/office-instructions-repository.fixtures.js";
import { OfficeInstructionsRepository } from "../ports/office-instructions-repository.js";
import { OfficeInstructions } from "./office-instructions.js";
import { FireAlarmLifts, HELD_BY_THE_FIRE_ALARM } from "./fire-alarm-lifts.js";
import { ApprovalHolds } from "./approval-holds.js";
import { FireAlarmLiftRepository } from "../ports/fire-alarm-lift-repository.js";
import { PostgresFireAlarmLiftRepository } from "../adapters/postgres/postgres-fire-alarm-lift-repository.js";
import { ChangesAllowedRepository } from "../ports/changes-allowed-repository.js";
import { PostgresChangesAllowedRepository } from "../adapters/postgres/postgres-changes-allowed-repository.js";
import {
  sessionMcpServersStandIn,
  type SessionMcpServersStandIn,
} from "./session-mcp-servers.fixtures.js";
import { GitHubModule } from "../../github/index.js";
import { signedInWithGitHubForTests } from "../../github/index.fixtures.js";
import { ProjectOutputMasks } from "../ports/project-output-masks.js";
import { ProjectOutputMasksForTests } from "../ports/project-output-masks.fixtures.js";
import { SubAgentsAndProcesses } from "./sub-agents-and-processes.js";
import { SubAgentAndProcessRepository } from "../ports/sub-agent-and-process-repository.js";
import { PostgresSubAgentAndProcessRepository } from "../adapters/postgres/postgres-sub-agent-and-process-repository.js";
import { MCP_TOOL_DEFAULT_STAND_IN } from "../../people/index.fixtures.js";
import type { UserRef } from "../domain/user.js";
import { ANN_LEE, ANSWERED_BY_ANN_LEE, BEN_ITO } from "../domain/user.fixtures.js";

/** Who holds each duty: their default Roles, until a test moves one. */
let duties: DutiesStandIn;

const outputMasks = new ProjectOutputMasksForTests();

/** The user token of the sign-in the app holds, which no session's options may carry. */
const GITHUB_USER_TOKEN = "ghu_session_check_token";

type Card = SessionRole["card"];
type Step = SessionScript[number];

const PLANNER: Card = aPlannerCard();

const USAGE = { input: 3, output: 120, cacheRead: 0, cacheCreation: 26_000 };
const WINDOW = 1_000_000;

let app: INestApplication;
let engine: ScriptedEngine;
let officeData: string;
/** Each card version of the Planner's Role, from 1, under a key of this test's own. */
let versions: Card[];
let cascade: EngineCascadeStandIn;
let roleKey: string;
const NO_SESSION_REASON = "This Task is Done, so its conversation can't go on.";
/** The user's first message in a planning Thread, which starts the Planner. */
const PLAN_IT = "Let's plan the export.";
/** Tasks whose setup says no session can work on them (Done: Publish removed the worktree). */
const tasksWithoutSessions = new Set<string>();
/** Tasks whose Threads are people's, only read, as the Work module sets them up. */
const tasksAsked = new Set<string>();
/** The records of Tasks and Ideas as the Work module words them, by id. */
const workRecords = new Map<string, string>();
/** The Tasks of the Initiatives here, by id, with their titles, as Work gives them. */
const initiativeTasks = new Map<
  string,
  { readonly initiativeId: string; readonly title: string }
>();
/** The Office tools of the Initiatives' Threads here: a test planning one adds open_decision. */
let initiativeOfficeTools: readonly string[];
/** The Initiatives here with a Pipeline, confirmed, by id: their Threads read their branch. */
const initiativeBranchReads = new Map<string, InitiativeBranchReads>();
/** What each refresh of the Initiatives' checkouts was asked for, in order. */
let refreshedOnInitiative: InitiativeBranchReads[];
/** The people's and Projects' short records, as People and Projects word them, by key and id. */
const personRecords = new Map<string, string>();
const projectRecords = new Map<string, string>();

let threads: ThreadService;
let runner: ThreadRunner;
let repository: ThreadRepository;
let decisions: DecisionService;
/** The sessions whose skills were forgotten, as each was replaced. */
let forgotten: string[];
/** What each new session's skills were prepared for. */
let prepared: Parameters<SessionSkills["prepare"]>[0][];
/** What the MCP servers module stands in for, and the servers it gives new and resumed sessions. */
let mcpServers: SessionMcpServersStandIn;
let mcpServersOnStart: PreparedMcpServers;
let mcpServersOnResume: PreparedMcpServers;

/** A server a session runs, and one of the Role's it is told it doesn't get. */
const WITH_MCP_SERVERS: PreparedMcpServers = {
  servers: [
    {
      name: "github",
      launch: { transport: "streamable-http", url: "https://mcp.example.com", headers: {} },
      tools: [{ name: "list_issues", description: "Lists the issues.", inputSchema: {} }],
    },
  ],
  leftOut: [{ name: "linear", reason: "it has no value for LINEAR_TOKEN." }],
};
const NO_MCP_SERVERS: PreparedMcpServers = { servers: [], leftOut: [] };

const PROJECTS: BriefProject[] = [
  {
    projectId: "admin-panel",
    name: "Admin panel",
    baseBranch: "main",
    folder: "/office/bases/admin-panel",
  },
];

beforeEach(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-threads-"));
  versions = [PLANNER];
  roleKey = `role-${randomUUID()}`;
  duties = new DutiesStandIn();
  cascade = new EngineCascadeStandIn();
  cascade.set(roleKey, { engineId: FIRST_CLAUDE_CODE_ENGINE.id, model: "claude-opus-5-5" });
  mcpServersOnStart = NO_MCP_SERVERS;
  mcpServersOnResume = NO_MCP_SERVERS;
  initiativeOfficeTools = ["read_task"];
  initiativeTasks.clear();
  initiativeBranchReads.clear();
  refreshedOnInitiative = [];
});

afterEach(async () => {
  await app.close();
  await rm(officeData, { recursive: true, force: true });
});

/** Boots the runner on a scripted engine that replays `scripts`, one per session opened. */
async function startWith(...scripts: SessionScript[]): Promise<void> {
  await startOn(scripts);
}

/** The engine settings with `api`'s endpoint beside the Claude Code engine. */
function listing(api: ApiEngineOnFakeServer) {
  const engines = [FIRST_CLAUDE_CODE_ENGINE, api.endpoint];
  return {
    provide: EngineModels,
    useValue: new EngineModels(new EngineSettingsForTests({ engines })),
  };
}

/**
 * Boots the runner with the Agent SDK's stand-in replaying `scripts`, and the OpenAI-compatible API
 * on `api`, its endpoint listed beside the Claude Code engine.
 */
async function startOn(
  scripts: readonly SessionScript[],
  api?: ApiEngineOnFakeServer,
): Promise<void> {
  engine = new ScriptedEngine(scripts);
  forgotten = [];
  prepared = [];
  mcpServers = sessionMcpServersStandIn(mcpServersOnStart, mcpServersOnResume);
  // The library is shared by every test file, so the sessions here get no skills of it.
  const sessionSkills: Pick<SessionSkills, "prepare" | "rebuild" | "forget"> = {
    prepare: (request) => {
      prepared.push(request);
      return Promise.resolve(noSkills(request.sessionId));
    },
    rebuild: (sessionId) => Promise.resolve(noSkills(sessionId)),
    forget: (sessionId) => {
      forgotten.push(sessionId);
      return Promise.resolve();
    },
  };
  const roleCards: Pick<RoleCards, "find" | "forResumedSession"> = {
    find: (key) => Promise.resolve(key === roleKey ? sessionRole(versions.length) : undefined),
    forResumedSession: (_key, version) => Promise.resolve(sessionRole(version)),
  };
  const bases: ProjectBases = {
    ...projectBasesOver(join(officeData, "bases"), PROJECTS),
    refreshOnInitiative: (reads) => {
      refreshedOnInitiative.push(reads);
      return Promise.resolve(PROJECTS);
    },
  };
  ({ app } = await startTestApplication({
    database: true,
    imports: [
      EventsModule,
      ScheduleModule,
      EventStreamModule,
      TelemetryModule,
      OfficeDataModule.forRoot(officeData),
      ScriptedEngineModule.register({
        "agent-sdk": engine,
        "claude-code-p": new ScriptedEngine([]),
        "openai-compatible-api": api?.engine ?? new ScriptedEngine([]),
      }),
      // Signed in with GitHub, as the app may be, so a session holding the token would show.
      GitHubModule.register(),
      BusyWorkModule,
    ],
    providers: [
      { provide: ThreadRepository, useClass: PostgresThreadRepository },
      { provide: RoleCards, useValue: roleCards },
      { provide: EngineCascade, useValue: cascade },
      { provide: ProjectBases, useValue: bases },
      { provide: ProjectOutputMasks, useValue: outputMasks },
      { provide: SessionSkills, useValue: sessionSkills },
      { provide: SessionMcpServers, useValue: mcpServers.service },
      { provide: ConversationsSettings, useValue: new ConversationsSettingsForTests() },
      { provide: OfficeInstructionsRepository, useClass: OfficeInstructionsRepositoryForTests },
      OfficeInstructions,
      ContextPolicySettingsService,
      ThreadService,
      Briefs,
      sessionMemoryProvider(),
      dutiesProvider(duties),
      TaskThreadSetups,
      InitiativeThreadSetups,
      SessionPlaces,
      CallChains,
      ThreadContexts,
      AllowChanges,
      ThreadRunner,
      FireAlarmLifts,
      ApprovalHolds,
      { provide: FireAlarmLiftRepository, useClass: PostgresFireAlarmLiftRepository },
      { provide: ChangesAllowedRepository, useClass: PostgresChangesAllowedRepository },
      MentionedRecords,
      ...openPageRecordProviders(personRecords, projectRecords),
      WorkRecords,
      StageThreads,
      {
        provide: SubAgentAndProcessRepository,
        useClass: PostgresSubAgentAndProcessRepository,
      },
      SubAgentsAndProcesses,
      InterruptedAnswers,
      DecisionService,
      Consultations,
      FireAlarmInThreads,
      DecisionOfficeTools,
    ],
    overrides: [
      signedInWithGitHubForTests(GITHUB_USER_TOKEN),
      ...(api === undefined ? [] : [listing(api)]),
    ],
  }));
  // As the Projects and People modules register theirs, and ProposalOfficeTools the Caretaker's
  // set-up; DecisionOfficeTools registers its own.
  for (const name of [
    ...CHAT_OFFICE_TOOLS.filter((tool) => tool !== ANSWER_DECISION_TOOL),
    PROPOSE_OFFICE_SETUP_TOOL,
  ]) {
    app.get(OfficeToolRegistry).register({
      name,
      description: `Reads ${name}.`,
      input: z.object({}),
      run: () => Promise.resolve({ text: "Nothing.", isError: false }),
    });
  }
  // As the Work module sets up its Tasks' Threads.
  app.get(TaskThreadSetups).provide({
    planner: () => Promise.resolve("planner"),
    readyForPersonsThread: () => Promise.resolve(undefined),
    planningThreadElsewhere: () => Promise.resolve(undefined),
    setUp: ({ taskId, firstSession }) =>
      Promise.resolve({
        ...(tasksAsked.has(taskId) ? askingSetup(taskId, firstSession) : taskSetup(taskId)),
        sessionRefusal: tasksWithoutSessions.has(taskId) ? NO_SESSION_REASON : undefined,
      }),
  });
  // As the Work module sets up its Initiatives' Threads.
  app.get(InitiativeThreadSetups).provide({
    setUp: ({ initiativeId }) =>
      Promise.resolve({
        instructions: "On this Initiative you shape.",
        officeTools: initiativeOfficeTools,
        record: `You are shaping the Initiative ${initiativeId}.`,
        asking: false,
        sessionRefusal: undefined,
        branchReads: initiativeBranchReads.get(initiativeId),
      }),
  });
  // As the Work module gives its records.
  app.get(WorkRecords).provide({
    taskSubjects: () => Promise.resolve(new Map()),
    taskRecord: (taskId) => Promise.resolve(workRecords.get(taskId)),
    taskTitle: (taskId) => Promise.resolve(initiativeTasks.get(taskId)?.title),
    taskAttachmentIds: () => Promise.resolve([]),
    initiativeTaskAttachmentIds: (initiativeId, taskId) =>
      Promise.resolve(initiativeTasks.get(taskId)?.initiativeId === initiativeId ? [] : undefined),
    initiativeRecord: (initiativeId) => Promise.resolve(workRecords.get(initiativeId)),
    initiativeName: () => Promise.resolve(undefined),
    projectWork: () => Promise.resolve({ taskIds: [], initiativeIds: [] }),
    ideaRecord: (ideaId) => Promise.resolve(workRecords.get(ideaId)),
  });
  threads = app.get(ThreadService);
  runner = app.get(ThreadRunner);
  repository = app.get(ThreadRepository);
  decisions = app.get(DecisionService);
}

/** What a session on the Task works with in these tests. */
function taskSetup(taskId: string): TaskThreadSetup {
  return {
    folder: join(officeData, "worktrees", "admin-panel", taskId),
    environment: { PROJECT_VARIABLE: "set" },
    useProjectSkills: true,
    projectSkillsOff: [],
    projectId: "admin-panel",
    instructions: "On this Task you plan.",
    officeTools: ["read_task", OPEN_DECISION_TOOL],
    brief: `You are planning the Task ${taskId}.`,
    asking: false,
    sessionRefusal: undefined,
  };
}

/** What a person's Thread on the Task works with in these tests. */
function askingSetup(taskId: string, firstSession: boolean): TaskThreadSetup {
  return {
    ...taskSetup(taskId),
    instructions: "On this Task you are asked.",
    officeTools: ["read_task"],
    brief: firstSession ? `The record of the Task ${taskId}.` : undefined,
    asking: true,
  };
}

function noSkills(sessionId: string): Awaited<ReturnType<SessionSkills["prepare"]>> {
  return {
    folder: join(officeData, "sessions", sessionId, "skills"),
    names: [],
    expected: [],
    overrides: {},
    versions: [],
    suffixMatches: [],
  };
}

function sessionRole(version: number): SessionRole {
  const card = versions[version - 1];
  if (!card) throw new Error(`The Planner's card has no version ${version}.`);
  return { roleKey, cardVersion: version, card, mcpToolDefault: MCP_TOOL_DEFAULT_STAND_IN };
}

/** A session's turn: what the person writes, then its end, with the context it leaves. */
function aTurn(consumed: string, text: string, contextTokens = 32_000): Step[] {
  return [
    { step: "event", event: { kind: "text", text, withinToolCall: undefined } },
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
    { step: "read-context-usage", usage: { tokens: contextTokens, window: WINDOW } },
  ];
}

function started(...steps: Step[]): SessionScript {
  return [{ step: "start", brief: { id: "brief", text: "" } }, ...steps];
}

function sent(id: string): Step {
  return { step: "send", message: { id, text: "" }, priority: "later" };
}

/**
 * Waits until the person's answer is in and the Thread waits for the user again; throws with the
 * reason when the person couldn't answer.
 */
async function answered(threadId: string, messages: number): Promise<readonly Message[]> {
  const log = await vi.waitFor(
    async () => {
      const thread = await threads.read(threadId);
      const logged = await threads.messages(threadId);
      if (thread.state !== "waiting" || logged.length < messages) {
        throw new Error("Still answering.");
      }
      return logged;
    },
    { timeout: 5_000, interval: 20 },
  );
  const failure = log.find((message) => message.kind === "failure");
  if (failure?.kind === "failure") throw new Error(`The person couldn't answer: ${failure.reason}`);
  return log;
}

/** The log without what each message gets as it is logged. */
function drafts(log: readonly Message[]): MessageDraft[] {
  return log.map(({ id: _id, threadId: _threadId, at: _at, ...draft }) => draft);
}

/** Moves the Thread's session back in time and sets its context, as an hour passing would. */
async function cooled(threadId: string, contextTokens: number): Promise<void> {
  await repository.update(threadId, (thread) => {
    const session = thread.session as ThreadSession;
    const cooledThread: Thread = {
      ...thread,
      session: {
        ...session,
        lastCallAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        contextTokens,
      },
    };
    return { thread: cooledThread, logged: [], event: new TurnEnded(cooledThread, new Date()) };
  });
}

/** A Thread whose session answered once under the Office instructions `text`, then cooled. */
async function cooledAfterAnswering(text: string): Promise<Thread> {
  await app.get(OfficeInstructions).save(text, ANN_LEE);
  const thread = await threads.startInChat(roleKey);
  await runner.send(thread.id, "Hello.", ANN_LEE);
  await answered(thread.id, 3);
  await runner.onModuleDestroy();
  await cooled(thread.id, 12_000);
  return thread;
}

/** Any Brief's text, as a line keeps it. */
const A_BRIEF: unknown = expect.any(String);

/** The move's line; a move that starts a session with a Brief keeps the Brief's text. */
function contextLine(decision: Partial<ContextDecision>): MessageDraft {
  return {
    kind: "context",
    move: decision.move ?? "fresh",
    reason: decision.reason ?? "new-thread",
    contextTokens: decision.contextTokens ?? 0,
    briefTokens: decision.briefTokens,
    brief: decision.briefTokens === undefined ? undefined : (A_BRIEF as string),
  };
}

describe("a new Thread's first message", () => {
  it("starts a session briefed with the Projects, read-only, logging what the person does", async () => {
    await startWith(
      started(
        {
          step: "event",
          event: {
            kind: "tool-call",
            callId: "c-1",
            tool: "Read",
            officeTool: false,
            input: { file_path: "/office/bases/admin-panel/README.md" },
            withinToolCall: undefined,
          },
        },
        {
          step: "event",
          event: {
            kind: "tool-refused",
            callId: "c-2",
            tool: "Edit",
            reason: "This session only reads: changes happen on Tasks.",
            refusedBy: "office-rules",
          },
        },
        ...aTurn("brief", "It deploys on every push to main."),
      ),
    );
    const thread = await threads.startInChat(roleKey);

    const answering = await runner.send(thread.id, "Read the deploy workflow.", ANN_LEE);
    const log = await answered(thread.id, 5);

    expect(answering.state).toBe("answering");
    const [session] = engine.sessions;
    const brief = session?.received[0];
    expect(brief?.step === "start" && brief.brief.text).toMatch(
      /in a new Thread[\s\S]*Admin panel: its main branch[\s\S]*## The message from the user Ann Lee\n\nRead the deploy workflow\.$/,
    );
    expect(session?.options).toMatchObject({
      folder: join(officeData, "bases"),
      environment: {},
      model: "claude-opus-5-5",
      effort: "high",
      profile: { edit: false, run: { kind: "read-only-git" }, web: true },
      readsEngineTranscripts: false,
    });
    expect(session?.options.officeTools.map(({ name }) => name)).toEqual([
      ...CHAT_OFFICE_TOOLS,
      CONSULT_TOOL,
    ]);
    expect(JSON.stringify(session?.options)).not.toContain(GITHUB_USER_TOKEN);
    expect(session?.options.instructions).toContain("You are Jan, the Planner in The Office");
    // A chat's session is on no Task, so the Office tools writing onto one refuse it.
    await expect(threads.taskInSession(session?.id ?? "")).resolves.toBeUndefined();
    expect(session?.options.instructions).toContain("Plan in conversation: ask what is unclear.");
    expect(drafts(log)).toEqual([
      contextLine({ move: "fresh", reason: "new-thread", briefTokens: expect.any(Number) }),
      {
        kind: "user",
        text: "Read the deploy workflow.",
        delivery: "delivered",
        writtenBy: ANN_LEE,
      },
      {
        kind: "tool-activity",
        roleKey,
        tool: "Read",
        summary: "/office/bases/admin-panel/README.md",
      },
      {
        kind: "refusal",
        roleKey,
        tool: "Edit",
        reason: "This session only reads: changes happen on Tasks.",
      },
      { kind: "person", roleKey, text: "It deploys on every push to main." },
    ]);
    const after = await threads.read(thread.id);
    expect(after).toMatchObject({
      title: "Read the deploy workflow",
      tokens: USAGE,
      session: {
        id: session?.id,
        roleKey,
        cardVersion: 1,
        contextTokens: 32_000,
        startContextTokens: 32_000,
        full: false,
      },
    });
  });
});

describe("a chat's MCP servers", () => {
  it("starts the session with its Role's servers on the Office-wide values, its Brief led by those left out", async () => {
    mcpServersOnStart = WITH_MCP_SERVERS;
    await startWith(started(...aTurn("brief", "Hello.")));
    const thread = await threads.startInChat(roleKey);

    await runner.send(thread.id, "Hello.", ANN_LEE);
    await answered(thread.id, 3);

    const [session] = engine.sessions;
    expect(session?.options.mcpServers).toEqual(WITH_MCP_SERVERS.servers);
    expect(mcpServers.prepared).toEqual([
      {
        sessionId: session?.id,
        roleKey,
        projectId: undefined,
        workingFolder: join(officeData, "bases"),
      },
    ]);
    const brief = session?.received[0];
    expect(brief?.step === "start" && brief.brief.text).toMatch(
      /^## MCP servers left out\n\n[^#]*\n\n- linear: it has no value for LINEAR_TOKEN\.\n\n[\s\S]*## The message from the user Ann Lee\n\nHello\.$/,
    );
  });

  it("resumes with the servers it recorded, telling the session of those left out since", async () => {
    mcpServersOnStart = WITH_MCP_SERVERS;
    mcpServersOnResume = {
      servers: [],
      leftOut: [{ name: "github", reason: "it was turned off." }],
    };
    await startWith(started(...aTurn("brief", "Hello.")), [
      { step: "resume" },
      sent("m-2"),
      ...aTurn("m-2", "Back again."),
    ]);
    const thread = await threads.startInChat(roleKey);
    await runner.send(thread.id, "Hello.", ANN_LEE);
    await answered(thread.id, 3);
    await runner.onModuleDestroy();
    await cooled(thread.id, 12_000);

    await runner.send(thread.id, "Still there?", ANN_LEE);
    const log = await answered(thread.id, 6);

    const [first, resumed] = engine.sessions;
    expect(mcpServers.rebuilt).toEqual([first?.id]);
    expect(resumed?.options.mcpServers).toEqual([]);
    const message = resumed?.received.find((step) => step.step === "send");
    expect(message?.step === "send" && message.message.text).toMatch(
      /^## MCP servers left out\n\n[^#]*- github: it was turned off\.\n\nStill there\?$/,
    );
    // The log keeps what the user said.
    expect(drafts(log)[4]).toEqual({
      kind: "user",
      text: "Still there?",
      delivery: "delivered",
      writtenBy: ANN_LEE,
    });
  });
});

describe("a Thread more than one user writes in", () => {
  it("keeps who wrote each message, and tells the person who writes whenever the writer changes", async () => {
    await startWith(
      started(
        ...aTurn("brief", "Hello, Ann."),
        sent("m-2"),
        ...aTurn("m-2", "Hello, Ben."),
        sent("m-3"),
        ...aTurn("m-3", "On it."),
        sent("m-4"),
        ...aTurn("m-4", "Glad to."),
      ),
    );
    const thread = await threads.startInChat(roleKey);

    await runner.send(thread.id, "Hello.", ANN_LEE);
    await answered(thread.id, 3);
    await runner.send(thread.id, "Can you check the tests?", BEN_ITO);
    await answered(thread.id, 5);
    await runner.send(thread.id, "And the build too.", BEN_ITO);
    await answered(thread.id, 7);
    await runner.send(thread.id, "Thanks.", ANN_LEE);
    const log = await answered(thread.id, 9);

    const received = engine.sessions[0]?.received ?? [];
    const brief = received[0];
    expect(brief?.step === "start" && brief.brief.text).toMatch(
      /\n\n## The message from the user Ann Lee\n\nHello\.$/,
    );
    expect(received.flatMap((step) => (step.step === "send" ? [step.message.text] : []))).toEqual([
      "## The message from the user Ben Ito\n\nCan you check the tests?",
      "And the build too.",
      "## The message from the user Ann Lee\n\nThanks.",
    ]);
    expect(
      log.flatMap((message) =>
        message.kind === "user" ? [[message.text, message.writtenBy]] : [],
      ),
    ).toEqual([
      ["Hello.", ANN_LEE],
      ["Can you check the tests?", BEN_ITO],
      ["And the build too.", BEN_ITO],
      ["Thanks.", ANN_LEE],
    ]);
  });
});

describe("continuing a Thread", () => {
  it("sends a message within the hour to the running session, with no context line", async () => {
    await startWith(started(...aTurn("brief", "Hello."), sent("m-2"), ...aTurn("m-2", "Sure.")));
    const thread = await threads.startInChat(roleKey);
    await runner.send(thread.id, "Hello.", ANN_LEE);
    await answered(thread.id, 3);

    await runner.send(thread.id, "And the tests?", ANN_LEE);
    const log = await answered(thread.id, 5);

    expect(engine.sessions).toHaveLength(1);
    expect(drafts(log).slice(3)).toEqual([
      { kind: "user", text: "And the tests?", delivery: "delivered", writtenBy: ANN_LEE },
      { kind: "person", roleKey, text: "Sure." },
    ]);
    expect((await threads.read(thread.id)).tokens.output).toBe(2 * USAGE.output);
  });

  it("counts the running turn's tokens as they come, then the turn's own", async () => {
    const soFar = { input: 3, output: 40, cacheRead: 9_000, cacheCreation: 0 };
    await startWith(
      started({ step: "event", event: { kind: "turn-tokens", soFar } }, ...aTurn("brief", "Hi.")),
    );
    const counted: Thread[] = [];
    app.get(EventBus).subscribeToEveryEvent((event: DomainEvent) => {
      if (event instanceof TokensCounted) counted.push(event.thread);
    });
    const thread = await threads.startInChat(roleKey);

    await runner.send(thread.id, "Hello.", ANN_LEE);
    await answered(thread.id, 3);

    expect(counted.map(({ tokens, runningTurnTokens }) => [tokens, runningTurnTokens])).toEqual([
      [NO_TOKENS, soFar],
    ]);
    expect(await threads.read(thread.id)).toMatchObject({
      tokens: USAGE,
      runningTurnTokens: NO_TOKENS,
    });
  });

  it("resumes a cooled Thread with a small context, on the card version its session started with", async () => {
    await startWith(started(...aTurn("brief", "Hello.")), [
      { step: "resume" },
      sent("m-2"),
      ...aTurn("m-2", "Back again."),
    ]);
    const thread = await threads.startInChat(roleKey);
    await runner.send(thread.id, "Hello.", ANN_LEE);
    await answered(thread.id, 3);
    // The service restarts, the cache cools, and the card changes meanwhile.
    await runner.onModuleDestroy();
    await cooled(thread.id, 12_000);
    versions.push({ ...PLANNER, effort: "low" });

    await runner.send(thread.id, "Still there?", ANN_LEE);
    const log = await answered(thread.id, 6);

    const [first, resumed] = engine.sessions;
    expect(resumed?.id).toBe(first?.id);
    // The same options, but the holds, functions made for each move.
    expect(withoutHolds(resumed?.options)).toEqual(withoutHolds(first?.options));
    expect(drafts(log).slice(3)).toEqual([
      contextLine({ move: "resume", reason: "small-context", contextTokens: 12_000 }),
      { kind: "user", text: "Still there?", delivery: "delivered", writtenBy: ANN_LEE },
      { kind: "person", roleKey, text: "Back again." },
    ]);
  });

  it("resumes a Thread on its engine and the model the cascade gives now", async () => {
    await startWith(started(...aTurn("brief", "Hello.")), [
      { step: "resume" },
      sent("m-2"),
      ...aTurn("m-2", "Back again."),
    ]);
    const thread = await threads.startInChat(roleKey);
    await runner.send(thread.id, "Hello.", ANN_LEE);
    await answered(thread.id, 3);
    await runner.onModuleDestroy();
    await cooled(thread.id, 12_000);
    cascade.set(roleKey, { engineId: FIRST_CLAUDE_CODE_ENGINE.id, model: "claude-haiku-5-5" });

    await runner.send(thread.id, "Still there?", ANN_LEE);
    await answered(thread.id, 6);

    const [first, resumed] = engine.sessions;
    expect(resumed?.id).toBe(first?.id);
    expect(first?.options.model).toBe("claude-opus-5-5");
    expect(resumed?.options).toMatchObject({
      engine: { id: FIRST_CLAUDE_CODE_ENGINE.id },
      model: "claude-haiku-5-5",
    });
  });

  describe("the Office instructions", () => {
    const RESUMED: SessionScript = [
      { step: "resume" },
      sent("m-2"),
      ...aTurn("m-2", "Back again."),
    ];

    it("starts a session with the current text and records its version", async () => {
      await startWith(started(...aTurn("brief", "Hello.")));
      await app.get(OfficeInstructions).save("An older text.", ANN_LEE);
      await app.get(OfficeInstructions).save("Answer in plain words.", ANN_LEE);

      const thread = await threads.startInChat(roleKey);
      await runner.send(thread.id, "Hello.", ANN_LEE);
      await answered(thread.id, 3);

      const instructions = engine.sessions[0]?.options.instructions;
      expect(instructions).toContain("Answer in plain words.");
      expect(instructions).not.toContain("An older text.");
      expect((await threads.read(thread.id)).session?.officeInstructionsVersion).toBe(2);
    });

    it("starts a session with none while none are saved, recording version 0", async () => {
      await startWith(started(...aTurn("brief", "Hello.")));

      const thread = await threads.startInChat(roleKey);
      await runner.send(thread.id, "Hello.", ANN_LEE);
      await answered(thread.id, 3);

      expect(engine.sessions[0]?.options.instructions).not.toContain("Office instructions");
      expect((await threads.read(thread.id)).session?.officeInstructionsVersion).toBe(0);
    });

    it("resumes a session across a change with the version it recorded", async () => {
      await startWith(started(...aTurn("brief", "Hello.")), RESUMED);
      const thread = await cooledAfterAnswering("Answer in plain words.");
      await app.get(OfficeInstructions).save("Answer in French.", ANN_LEE);

      await runner.send(thread.id, "Still there?", ANN_LEE);
      await answered(thread.id, 6);

      const [first, resumed] = engine.sessions;
      expect(resumed?.id).toBe(first?.id);
      expect(first?.options.instructions).toContain("Answer in plain words.");
      expect(resumed?.options.instructions).toBe(first?.options.instructions);
    });

    it("resumes a session stored without a version with none", async () => {
      await startWith(started(...aTurn("brief", "Hello.")), RESUMED);
      const thread = await cooledAfterAnswering("Answer in plain words.");
      await repository.update(thread.id, storedBeforeOfficeInstructions);

      await runner.send(thread.id, "Still there?", ANN_LEE);
      await answered(thread.id, 6);

      const [first, resumed] = engine.sessions;
      expect(resumed?.id).toBe(first?.id);
      expect(resumed?.options.instructions).not.toContain("Office instructions");
      expect(resumed?.options.instructions).not.toContain("Answer in plain words.");
    });

    it("gives a fresh session the new text and records its version", async () => {
      await startWith(started(...aTurn("brief", "Hello.")), started(...aTurn("brief", "Oui.")));
      const thread = await cooledAfterAnswering("Answer in plain words.");
      await cooled(thread.id, 80_000);
      await app.get(OfficeInstructions).save("Answer in French.", ANN_LEE);

      await runner.send(thread.id, "Still there?", ANN_LEE);
      await answered(thread.id, 6);

      const [first, fresh] = engine.sessions;
      expect(fresh?.id).not.toBe(first?.id);
      expect(fresh?.options.instructions).toContain("Answer in French.");
      expect(fresh?.options.instructions).not.toContain("Answer in plain words.");
      expect((await threads.read(thread.id)).session?.officeInstructionsVersion).toBe(2);
    });
  });

  it("starts a cooled Thread with a large context fresh, briefed from its log, on the current card", async () => {
    await startWith(
      started(...aTurn("brief", "It deploys on push.")),
      started(...aTurn("brief", "Yes.")),
    );
    const thread = await threads.startInChat(roleKey);
    await runner.send(thread.id, "Read the deploy workflow.", ANN_LEE);
    await answered(thread.id, 3);
    await cooled(thread.id, 80_000);
    versions.push({ ...PLANNER, effort: "low" });
    cascade.set(roleKey, { engineId: FIRST_CLAUDE_CODE_ENGINE.id, model: "claude-sonnet-5-5" });

    await runner.send(thread.id, "And the tests?", ANN_LEE);
    const log = await answered(thread.id, 6);

    const [first, fresh] = engine.sessions;
    expect(fresh?.id).not.toBe(first?.id);
    expect(forgotten).toEqual([first?.id]);
    expect(fresh?.options).toMatchObject({ model: "claude-sonnet-5-5", effort: "low" });
    const brief = fresh?.received[0];
    expect(brief?.step === "start" && brief.brief.text).toMatch(
      /in a fresh session[\s\S]*## The Thread\n\nRead the deploy workflow[\s\S]*The user Ann Lee: Read the deploy workflow\.\n\nYou: It deploys on push\.[\s\S]*## The message from the user Ann Lee\n\nAnd the tests\?$/,
    );
    expect(drafts(log)[3]).toEqual(
      contextLine({
        move: "fresh",
        reason: "cache-expired",
        contextTokens: 80_000,
        briefTokens: expect.any(Number),
      }),
    );
    expect((await threads.read(thread.id)).session).toMatchObject({
      id: fresh?.id,
      cardVersion: 2,
    });
  });

  it("starts a cooled Thread fresh once Settings lowers the size threshold below its context", async () => {
    await startWith(started(...aTurn("brief", "Hello.")));
    const thread = await threads.startInChat(roleKey);
    await runner.send(thread.id, "Hello.", ANN_LEE);
    await answered(thread.id, 3);
    // 8k more than the session's first turn took.
    await cooled(thread.id, 40_000);
    const contexts = app.get(ThreadContexts);
    const before = await contexts.of(await threads.read(thread.id));

    await app.get(ContextPolicySettingsService).changeSizeThreshold(5_000);
    const after = await contexts.of(await threads.read(thread.id));

    expect(before).toMatchObject({ move: "resume", reason: "small-context" });
    expect(after).toMatchObject({ move: "fresh", reason: "cache-expired" });
  });

  it("starts fresh while the cache is warm when the user chose Start fresh, once", async () => {
    await startWith(started(...aTurn("brief", "Hello.")), started(...aTurn("brief", "Fresh.")));
    const thread = await threads.startInChat(roleKey);
    await runner.send(thread.id, "Hello.", ANN_LEE);
    await answered(thread.id, 3);

    await threads.chooseOverride(thread.id, "start-fresh");
    await runner.send(thread.id, "Start over.", ANN_LEE);
    const log = await answered(thread.id, 6);

    expect(engine.sessions).toHaveLength(2);
    expect(drafts(log)[3]).toMatchObject({ kind: "context", move: "fresh", reason: "your-choice" });
    expect((await threads.read(thread.id)).override).toBeUndefined();
  });

  it("refuses a message while the person is still answering", async () => {
    await startWith(started(sent("never")));
    const thread = await threads.startInChat(roleKey);
    await runner.send(thread.id, "Hello.", ANN_LEE);

    await expect(runner.send(thread.id, "Hello again.", ANN_LEE)).rejects.toThrow(
      new ThreadRefused(["Jan is still answering. Send it once they finish."]),
    );
  });

  it("refuses to continue once the person's Chat is off, keeping the Thread readable", async () => {
    await startWith(started(...aTurn("brief", "Hello.")));
    const thread = await threads.startInChat(roleKey);
    await runner.send(thread.id, "Hello.", ANN_LEE);
    await answered(thread.id, 3);
    versions.push({ ...PLANNER, capabilities: { ...PLANNER.capabilities, chat: false } });

    await expect(runner.send(thread.id, "Hello again.", ANN_LEE)).rejects.toThrow(ThreadRefused);
    await expect(threads.messages(thread.id)).resolves.toHaveLength(3);
  });

  it("refuses a message in words while no engine is listed, logging nothing", async () => {
    await startWith(started(...aTurn("brief", "Hello.")));
    const thread = await threads.startInChat(roleKey);
    cascade.removeEveryEngine();

    await expect(runner.send(thread.id, "Hello.", ANN_LEE)).rejects.toThrow(
      new ThreadRefused([
        "Settings › Engines lists no engine, so no session starts; add one there first.",
      ]),
    );
    await expect(threads.messages(thread.id)).resolves.toHaveLength(0);
    expect(engine.sessions).toHaveLength(0);
  });
});

/** The Thread's first exchange, its session then ended as when the service stops, and cooled. */
async function cooledAfterFirstAnswer(contextTokens: number): Promise<Thread> {
  const thread = await threads.startInChat(roleKey);
  await runner.send(thread.id, "Read the deploy workflow.", ANN_LEE);
  await answered(thread.id, 3);
  await runner.onModuleDestroy();
  await cooled(thread.id, contextTokens);
  return threads.read(thread.id);
}

describe("a Thread on the OpenAI-compatible API, its own sessions on a fake server", () => {
  let api: ApiEngineOnFakeServer;

  beforeEach(async () => {
    api = await apiEngineOnFakeServer(officeData);
    cascade.set(roleKey, { engineId: api.endpoint.id, model: api.endpoint.defaultModel });
    await startOn([], api);
  });

  afterEach(async () => {
    await api.server.close();
  });

  /** The messages each request to the server carried, in order. */
  function requestedMessages(): { readonly role: string; readonly content?: unknown }[][] {
    const body = z.object({ messages: z.array(z.looseObject({ role: z.string() })) });
    return api.server.requests.map((request) => body.parse(request.body).messages);
  }

  it("starts a warm Thread fresh on the engine the cascade switched to", async () => {
    api.server.script(textReply(["It deploys on push."]));
    const thread = await threads.startInChat(roleKey);
    await runner.send(thread.id, "Read the deploy workflow.", ANN_LEE);
    await answered(thread.id, 3);
    cascade.set(roleKey, { engineId: FIRST_CLAUDE_CODE_ENGINE.id, model: "claude-sonnet-5-5" });
    engine.queue(started(...aTurn("brief", "Still here.")));

    await runner.send(thread.id, "Still there?", ANN_LEE);
    const log = await answered(thread.id, 6);

    expect(drafts(log)[3]).toEqual(
      contextLine({
        move: "fresh",
        reason: "engine-changed",
        contextTokens: expect.any(Number),
        briefTokens: expect.any(Number),
      }),
    );
    expect((await threads.read(thread.id)).session).toMatchObject({
      id: engine.sessions[0]?.id,
      cardVersion: 1,
      engineId: FIRST_CLAUDE_CODE_ENGINE.id,
    });
  });

  it("labels a Thread on a Task with the engine the cascade gives in the Task's Project", async () => {
    await startWith(started(...aTurn("brief", "What must be true when it is done?")));
    cascade.set(roleKey, { engineId: "lab", model: "llama" });
    cascade.set(
      roleKey,
      { engineId: FIRST_CLAUDE_CODE_ENGINE.id, model: "claude-haiku-5-5" },
      "admin-panel",
    );
    const opened = await planningThread();
    await runner.send(opened.id, PLAN_IT, ANN_LEE);
    await answered(opened.id, 3);

    const label = await app.get(ThreadContexts).of(await threads.read(opened.id));

    expect(engine.sessions[0]?.options).toMatchObject({
      engine: { id: FIRST_CLAUDE_CODE_ENGINE.id },
      model: "claude-haiku-5-5",
    });
    expect(label).toMatchObject({ move: "resume", reason: "cache-warm" });
  });

  it("resumes a cooled Thread with a small context from the conversation the engine kept", async () => {
    api.server.script(textReply(["It deploys ", "on push."]), textReply(["The tests run first."]));
    const thread = await cooledAfterFirstAnswer(12_000);

    await runner.send(thread.id, "And the tests?", ANN_LEE);
    const log = await answered(thread.id, 6);

    expect(drafts(log).slice(3)).toEqual([
      contextLine({ move: "resume", reason: "small-context", contextTokens: 12_000 }),
      { kind: "user", text: "And the tests?", delivery: "delivered", writtenBy: ANN_LEE },
      { kind: "person", roleKey, text: "The tests run first." },
    ]);
    expect((await threads.read(thread.id)).session?.id).toBe(thread.session?.id);
    const [first = [], resumed = []] = requestedMessages();
    expect(resumed.slice(0, first.length)).toEqual(first);
    expect(resumed.slice(first.length)).toEqual([
      expect.objectContaining({ role: "assistant", content: "It deploys on push." }),
      expect.objectContaining({ role: "user", content: expect.stringContaining("And the tests?") }),
    ]);
  });

  it("starts a cooled Thread with a large context fresh, briefed from its log alone", async () => {
    api.server.script(textReply(["It deploys on push."]), textReply(["The tests run first."]));
    const thread = await cooledAfterFirstAnswer(80_000);

    await runner.send(thread.id, "And the tests?", ANN_LEE);
    const log = await answered(thread.id, 6);

    expect(drafts(log)[3]).toEqual(
      contextLine({
        move: "fresh",
        reason: "cache-expired",
        contextTokens: 80_000,
        briefTokens: expect.any(Number),
      }),
    );
    const fresh = (await threads.read(thread.id)).session?.id;
    expect(fresh).not.toBe(thread.session?.id);
    expect(forgotten).toEqual([thread.session?.id]);
    const [, freshRequest = []] = requestedMessages();
    expect(freshRequest.map(({ role }) => role)).toEqual(["system", "user"]);
    expect(freshRequest[1]?.content).toMatch(
      /in a fresh session[\s\S]*You: It deploys on push\.[\s\S]*## The message from the user Ann Lee\n\nAnd the tests\?$/,
    );
  });
});

describe("a Thread on a Task", () => {
  it("stays readable but takes no message once no session can work on its Task", async () => {
    const taskId = randomUUID();
    await startWith(started(...aTurn("brief", "What must be true when it is done?")));
    const opened = await planningThread(taskId);
    await runner.send(opened.id, PLAN_IT, ANN_LEE);
    await answered(opened.id, 3);
    const before = await threads.messages(opened.id);
    const stateBefore = (await threads.read(opened.id)).state;

    tasksWithoutSessions.add(taskId);

    await expect(runner.send(opened.id, "One more thing.", ANN_LEE)).rejects.toThrow(
      new ThreadRefused([NO_SESSION_REASON]),
    );
    expect(await threads.messages(opened.id)).toEqual(before);
    expect((await threads.read(opened.id)).state).toBe(stateBefore);
  });

  it("opens waiting for the user, then starts in the Task's worktree, read-only, on their first message", async () => {
    const taskId = randomUUID();
    const worktree = join(officeData, "worktrees", "admin-panel", taskId);
    await startWith(
      started(
        {
          step: "event",
          event: {
            kind: "tool-call",
            callId: "c-1",
            tool: "Read",
            officeTool: false,
            input: { file_path: join(worktree, "README.md") },
            withinToolCall: undefined,
          },
        },
        ...aTurn("brief", "What must be true when it is done?"),
      ),
    );

    const opened = await planningThread(taskId);

    expect(opened).toMatchObject({
      home: { kind: "task", taskId },
      title: "Planning",
      state: "waiting",
      session: undefined,
    });
    expect(await threads.messages(opened.id)).toEqual([]);
    expect(engine.sessions).toHaveLength(0);

    await runner.send(opened.id, PLAN_IT, ANN_LEE);
    const log = await answered(opened.id, 4);

    const [session] = engine.sessions;
    const brief = session?.received[0];
    expect(brief?.step === "start" && brief.brief.text).toBe(
      `You are planning the Task ${taskId}.\n\n## The message from the user Ann Lee\n\n${PLAN_IT}`,
    );
    expect(session?.options).toMatchObject({
      folder: worktree,
      environment: { PROJECT_VARIABLE: "set" },
      profile: { edit: false, run: { kind: "read-only-git" }, web: true },
      readsEngineTranscripts: false,
    });
    expect(session?.options.officeTools.map(({ name }) => name)).toEqual([
      "read_task",
      OPEN_DECISION_TOOL,
    ]);
    expect(session?.options.instructions).toMatch(
      /^You are Jan, the Planner in The Office[\s\S]*\n\nOn this Task you plan\.$/,
    );
    expect(prepared).toEqual([
      {
        sessionId: session?.id,
        roleKey,
        project: {
          id: "admin-panel",
          folder: worktree,
          useProjectSkills: true,
          projectSkillsOff: [],
        },
      },
    ]);
    expect(mcpServers.prepared).toEqual([
      { sessionId: session?.id, roleKey, projectId: "admin-panel", workingFolder: worktree },
    ]);
    expect(drafts(log)).toEqual([
      contextLine({ move: "fresh", reason: "new-thread", briefTokens: expect.any(Number) }),
      { kind: "user", text: PLAN_IT, delivery: "delivered", writtenBy: ANN_LEE },
      { kind: "tool-activity", roleKey, tool: "Read", summary: "README.md" },
      { kind: "person", roleKey, text: "What must be true when it is done?" },
    ]);
    // The line keeps the Brief as it was sent, for the user to read.
    expect(log[0]).toMatchObject({
      kind: "context",
      brief: `You are planning the Task ${taskId}.`,
    });
    expect((await threads.read(opened.id)).title).toBe("Planning");
    await expect(threads.taskInSession(session?.id ?? "")).resolves.toBe(taskId);
    await expect(threads.initiativeInSession(session?.id ?? "")).resolves.toBeUndefined();
    await expect(threads.personInSession(session?.id ?? "")).resolves.toBe(roleKey);
  });

  it("hides the Project's Secret variables in the person's words and tool calls, stored and live", async () => {
    const taskId = randomUUID();
    outputMasks.masks.set("admin-panel", {
      mask: (text) => text.replaceAll("npm_s3cret", "[secret NPM_TOKEN]"),
    });
    await startWith(
      started(
        {
          step: "event",
          event: {
            kind: "tool-call",
            callId: "c-1",
            tool: "Bash",
            officeTool: false,
            input: { command: "npm whoami --token npm_s3cret" },
            withinToolCall: undefined,
          },
        },
        ...aTurn("brief", "The token npm_s3cret works."),
      ),
    );
    const live: DomainEvent[] = [];
    app.get(EventBus).subscribeToEveryEvent((event: DomainEvent) => void live.push(event));

    try {
      const opened = await planningThread(taskId);
      await runner.send(opened.id, PLAN_IT, ANN_LEE);
      const log = await answered(opened.id, 4);

      expect(drafts(log).slice(2)).toEqual([
        {
          kind: "tool-activity",
          roleKey,
          tool: "Bash",
          summary: "npm whoami --token [secret NPM_TOKEN]",
        },
        { kind: "person", roleKey, text: "The token [secret NPM_TOKEN] works." },
      ]);
      expect(JSON.stringify(live)).not.toContain("npm_s3cret");
    } finally {
      outputMasks.masks.clear();
    }
  });

  it("ends the Task's waiting sessions before its worktree is removed, and no other Task's", async () => {
    const taskId = randomUUID();
    await startWith(
      started(...aTurn("brief", "What must be true when it is done?"), { step: "end" }),
      started(...aTurn("brief", "Which page?")),
    );
    const planning = await planningThread(taskId);
    await runner.send(planning.id, PLAN_IT, ANN_LEE);
    await answered(planning.id, 3);
    const other = await planningThread();
    await runner.send(other.id, PLAN_IT, ANN_LEE);
    await answered(other.id, 3);

    await runner.endWaiting(taskId);

    const [ended, kept] = engine.sessions;
    expect(ended?.received.at(-1)).toEqual({ step: "end" });
    expect(kept?.received.map(({ step }) => step)).not.toContain("end");
  });

  it("answers the user on a Task whatever the person's Chat is", async () => {
    await startWith(
      started(...aTurn("brief", "What must be true?"), sent("m-2"), ...aTurn("m-2", "Noted.")),
    );
    versions.push({ ...PLANNER, capabilities: { ...PLANNER.capabilities, chat: false } });
    const opened = await planningThread();
    await runner.send(opened.id, PLAN_IT, ANN_LEE);
    await answered(opened.id, 3);

    await runner.send(opened.id, "The page loads under a second.", ANN_LEE);
    const log = await answered(opened.id, 5);

    expect(drafts(log).slice(3)).toEqual([
      {
        kind: "user",
        text: "The page loads under a second.",
        delivery: "delivered",
        writtenBy: ANN_LEE,
      },
      { kind: "person", roleKey, text: "Noted." },
    ]);
  });

  it("starts at once on The Office's opening, briefed from the Task's record, as Make a plan does", async () => {
    const taskId = randomUUID();
    await startWith(started(...aTurn("brief", "I'll read the sign-in first.")));

    const opened = await threads.startOnTask({
      taskId,
      roleKey,
      title: "Planning",
      opening: "Plan this Task from its title and its Description.",
    });
    const log = await answered(opened.id, 2);

    expect(opened).toMatchObject({ home: { kind: "task", taskId }, title: "Planning" });
    const [session] = engine.sessions;
    const brief = session?.received[0];
    expect(brief?.step === "start" && brief.brief.text).toBe(
      `You are planning the Task ${taskId}.\n\n## What to do now\n\nPlan this Task from its title and its Description.`,
    );
    expect(exchanges(log)).toEqual([
      { kind: "person", roleKey, text: "I'll read the sign-in first." },
    ]);
  });

  it("refuses to open a Thread with a Role nobody fills", async () => {
    await startWith();

    await expect(
      threads.openOnTask({ taskId: randomUUID(), roleKey: "nobody", title: "Planning" }),
    ).rejects.toThrow(ThreadRefused);
    await expect(
      threads.startOnTask({
        taskId: randomUUID(),
        roleKey: "nobody",
        title: "Planning",
        opening: "Plan it.",
      }),
    ).rejects.toThrow(ThreadRefused);
    expect(engine.sessions).toHaveLength(0);
  });
});

/** Waits until the Thread waits for the user again, whatever happened. */
async function waiting(threadId: string): Promise<Thread> {
  return vi.waitFor(
    async () => {
      const thread = await threads.read(threadId);
      if (thread.state !== "waiting") throw new Error("Still answering.");
      return thread;
    },
    { timeout: 5_000, interval: 20 },
  );
}

const EXPORT_QUESTION = "Should the export include archived Projects?";
const COLUMNS_QUESTION = "Which columns go into the export?";

/** The person opens a Decision with The Office's tool, which answers at once. */
function opensDecision(callId: string, question: string, options: string[]): Step[] {
  return [
    {
      step: "event",
      event: {
        kind: "tool-call",
        callId,
        tool: OPEN_DECISION_TOOL,
        officeTool: true,
        input: {
          question,
          context: "Archived Projects have no worktree.",
          options,
          recommended: 1,
          why: "It is what the export is for.",
        },
        withinToolCall: undefined,
      },
    },
    {
      step: "event",
      event: { kind: "tool-result", callId, text: "", isError: false, withinToolCall: undefined },
    },
  ];
}

describe("a Thread on an Initiative", () => {
  it("opens on The Office's words reading every Project's base branch, briefed from the Initiative's record", async () => {
    const initiativeId = randomUUID();
    await startWith(started(...aTurn("brief", "What outcome do you want?")));

    const opened = await threads.startOnInitiative({
      initiativeId,
      roleKey,
      title: "Shaping",
      opening: "Shape the Initiative with the user.",
    });
    const log = await answered(opened.id, 2);

    expect(opened).toMatchObject({ home: { kind: "initiative", initiativeId }, title: "Shaping" });
    const [session] = engine.sessions;
    const brief = session?.received[0];
    expect(brief?.step === "start" && brief.brief.text).toMatch(
      new RegExp(
        `^You are shaping the Initiative ${initiativeId}\\.\\n\\n## The Projects[\\s\\S]*\\n\\n## What to do now\\n\\nShape the Initiative with the user\\.$`,
      ),
    );
    expect(session?.options).toMatchObject({
      folder: join(officeData, "bases"),
      readableFolders: [],
      profile: { edit: false, run: { kind: "read-only-git" }, web: true },
      readsEngineTranscripts: false,
    });
    expect(refreshedOnInitiative).toEqual([]);
    const tools = session?.options.officeTools.map(({ name }) => name);
    expect(tools).toContain("read_task");
    expect(tools).not.toContain(CHANGE_ROLE_TOOL);
    expect(tools).not.toContain(OPEN_DECISION_TOOL);
    expect(session?.options.instructions).toMatch(/\n\nOn this Initiative you shape\.$/);
    expect(prepared).toEqual([{ sessionId: session?.id, roleKey, project: undefined }]);
    expect(exchanges(log)).toEqual([
      { kind: "person", roleKey, text: "What outcome do you want?" },
    ]);
    await expect(threads.listOnInitiative(initiativeId)).resolves.toMatchObject([
      { id: opened.id },
    ]);
    await expect(threads.taskInSession(session?.id ?? "")).resolves.toBeUndefined();
    await expect(threads.initiativeInSession(session?.id ?? "")).resolves.toBe(initiativeId);
  });

  it("reads the Initiative's branch once it has one, from the base checkouts' folder, and resumes so", async () => {
    const initiativeId = randomUUID();
    const reads = { shortName: "sync", branch: "initiative/sync", projectIds: ["admin-panel"] };
    initiativeBranchReads.set(initiativeId, reads);
    await startWith(started(...aTurn("brief", "What outcome do you want?")), [
      { step: "resume" },
      sent("m-3"),
      ...aTurn("m-3", "Back again."),
    ]);

    const opened = await threads.startOnInitiative({
      initiativeId,
      roleKey,
      title: "Shaping",
      opening: "Shape the Initiative with the user.",
    });
    await answered(opened.id, 2);

    const [first] = engine.sessions;
    // The folder stays the one a session started while shaping works in, so it still resumes.
    expect(first?.options).toMatchObject({
      folder: join(officeData, "bases"),
      readableFolders: [join(officeData, "initiative-bases", "sync")],
    });
    expect(refreshedOnInitiative).toEqual([reads]);
    await runner.onModuleDestroy();
    await cooled(opened.id, 12_000);

    await runner.send(opened.id, "Still there?", ANN_LEE);
    await answered(opened.id, 5);

    const [, resumed] = engine.sessions;
    expect(resumed?.id).toBe(first?.id);
    expect(withoutHolds(resumed?.options)).toEqual(withoutHolds(first?.options));
    expect(refreshedOnInitiative).toEqual([reads, reads]);
  });

  it("resumes a session started while shaping once the Initiative reads its branch", async () => {
    const initiativeId = randomUUID();
    await startWith(started(...aTurn("brief", "What outcome do you want?")), [
      { step: "resume" },
      sent("m-3"),
      ...aTurn("m-3", "Back again."),
    ]);

    const opened = await threads.startOnInitiative({
      initiativeId,
      roleKey,
      title: "Shaping",
      opening: "Shape the Initiative with the user.",
    });
    await answered(opened.id, 2);
    await runner.onModuleDestroy();
    await cooled(opened.id, 12_000);
    const reads = { shortName: "sync", branch: "initiative/sync", projectIds: ["admin-panel"] };
    initiativeBranchReads.set(initiativeId, reads);

    await runner.send(opened.id, "Still there?", ANN_LEE);
    await answered(opened.id, 5);

    const [shaping, resumed] = engine.sessions;
    expect(resumed?.id).toBe(shaping?.id);
    expect(resumed?.options).toMatchObject({
      folder: shaping?.options.folder,
      readableFolders: [join(officeData, "initiative-bases", "sync")],
    });
    expect(refreshedOnInitiative).toEqual([reads]);
  });

  it("leaves a chat that mentions the Initiative reading the base checkouts alone", async () => {
    const initiativeId = randomUUID();
    initiativeBranchReads.set(initiativeId, {
      shortName: "sync",
      branch: "initiative/sync",
      projectIds: ["admin-panel"],
    });
    workRecords.set(initiativeId, "Offline sync (Initiative) · Outcome: writes survive.");
    await startWith(started(...aTurn("brief", "It syncs.")));
    const chat = await threads.startInChat(roleKey);

    await runner.send(chat.id, "What is [@Offline sync](/work)?", ANN_LEE, {
      mentions: [{ kind: "initiative", initiativeId }],
    });
    await answered(chat.id, 3);

    expect(engine.sessions[0]?.options).toMatchObject({
      folder: join(officeData, "bases"),
      readableFolders: [],
    });
    expect(refreshedOnInitiative).toEqual([]);
  });
});

/** A person's own Thread on a Task of its own, waiting for the user's first message. */
async function aPersonsThread(): Promise<Thread> {
  const taskId = randomUUID();
  tasksAsked.add(taskId);
  return threads.openOnTask({ taskId, roleKey, title: "Asking Ada" });
}

describe("a person's Thread on a Task", () => {
  it("starts its own session from the record, only reading, with nothing that waits", async () => {
    await startWith(started(...aTurn("brief", "It reads the session cookie.")));
    const thread = await aPersonsThread();

    await runner.send(thread.id, "Why the cookie?", ANN_LEE);
    await answered(thread.id, 3);

    const [session] = engine.sessions;
    const brief = session?.received[0];
    expect(brief?.step === "start" && brief.brief.text).toContain("The record of the Task");
    expect(session?.options).toMatchObject({
      profile: { edit: false, run: { kind: "read-only-git" } },
      readsEngineTranscripts: false,
    });
    expect(session?.options.instructions).toMatch(/On this Task you are asked\.$/);
    expect(session?.options.officeTools.map(({ name }) => name)).toEqual(["read_task"]);
  });

  it("briefs a later fresh session from the Thread alone, never the record again", async () => {
    await startWith(
      started(...aTurn("brief", "It reads the session cookie.")),
      started(...aTurn("brief", "Still the cookie.")),
    );
    const thread = await aPersonsThread();
    await runner.send(thread.id, "Why the cookie?", ANN_LEE);
    await answered(thread.id, 3);
    await threads.chooseOverride(thread.id, "start-fresh");

    await runner.send(thread.id, "And now?", ANN_LEE);
    await answered(thread.id, 6);

    const brief = engine.sessions[1]?.received[0];
    const text = brief?.step === "start" ? brief.brief.text : "";
    expect(text).toContain("You are continuing your Thread on a Task");
    expect(text).toContain("Why the cookie?");
    expect(text).not.toContain("The record of the Task");
  });

  it("answers beside the person's running Stage, and its tokens stay out of the budget", async () => {
    await startWith(started(...aTurn("brief", "It reads the session cookie.")));
    const thread = await aPersonsThread();
    const home = thread.home;
    await repository.add(
      aThread({ id: randomUUID(), home, roleKey, stageThread: true, state: "answering" }),
    );

    await runner.send(thread.id, "Why the cookie?", ANN_LEE);
    await answered(thread.id, 3);

    expect((await threads.read(thread.id)).tokens).not.toEqual(NO_TOKENS);
    const taskId = home.kind === "task" ? home.taskId : "";
    await expect(new TaskTokens(repository).budgetTokensSoFar(taskId)).resolves.toBe(0);
  });

  it("swaps the Planner's running session's tools once the Task is Ready", async () => {
    await startWith(started(...aTurn("brief", "Planned.")), [
      { step: "resume" },
      sent("m-2"),
      ...aTurn("m-2", "It was planned so."),
    ]);
    const opened = await planningThread();
    await runner.send(opened.id, PLAN_IT, ANN_LEE);
    await answered(opened.id, 3);
    tasksAsked.add(opened.home.kind === "task" ? opened.home.taskId : "");

    await runner.send(opened.id, "Why so?", ANN_LEE);
    await answered(opened.id, 5);

    const [first, resumed] = engine.sessions;
    expect(resumed?.id).toBe(first?.id);
    expect(resumed?.options.officeTools.map(({ name }) => name)).toEqual(["read_task"]);
  });
});

/** A Task's planning Thread, waiting for the user's first message. */
async function planningThread(taskId: string = randomUUID()): Promise<Thread> {
  return threads.openOnTask({ taskId, roleKey, title: "Planning" });
}

/** A Task's planning Thread where the Planner answers the user's first message. */
async function plannerAnswering(): Promise<Thread> {
  const opened = await planningThread();
  return runner.send(opened.id, PLAN_IT, ANN_LEE);
}

/**
 * The log without context lines and tool activity, whose order around a tool's own lines varies.
 */
function exchanges(log: readonly Message[]): MessageDraft[] {
  return drafts(log).filter(({ kind }) => kind !== "context" && kind !== "tool-activity");
}

describe("a Decision", () => {
  it("is opened by the person's tool, which returns at once, and waits on the user as a card in the Thread", async () => {
    await startWith(
      started(
        ...opensDecision("c-1", EXPORT_QUESTION, ["Only active Projects", "Every Project"]),
        ...aTurn("brief", "I asked about archived Projects."),
      ),
    );
    const opened = await plannerAnswering();

    const log = await answered(opened.id, 5);

    const thread = await threads.read(opened.id);
    const decision = {
      kind: "question",
      id: expect.any(String),
      threadId: opened.id,
      taskId: opened.home.kind === "task" ? opened.home.taskId : "",
      roleKey,
      question: EXPORT_QUESTION,
      context: "Archived Projects have no worktree.",
      options: ["Only active Projects", "Every Project"],
      recommendation: { option: 0, reason: "It is what the export is for." },
      attachmentIds: [],
      askedAt: expect.any(Date),
      passedOn: [],
      answer: undefined,
    };
    expect(thread.openDecisions[0]).toEqual(decision);
    expect(exchanges(log)).toEqual([
      { kind: "user", text: PLAN_IT, delivery: "delivered", writtenBy: ANN_LEE },
      { kind: "decision", roleKey, decisionId: thread.openDecisions[0]?.id },
      { kind: "person", roleKey, text: "I asked about archived Projects." },
    ]);
    await expect(decisions.listOpen()).resolves.toContainEqual(decision);
    await expect(decisions.openOn(thread.openDecisions[0]?.taskId ?? "")).resolves.toBe(1);
  });

  it("answered with an option goes into the running session with its question, and closes", async () => {
    await startWith(
      started(
        ...opensDecision("c-1", EXPORT_QUESTION, ["Only active Projects", "Every Project"]),
        ...aTurn("brief", "I asked."),
        sent("answer"),
        ...aTurn("answer", "Only active ones, then."),
      ),
    );
    const opened = await plannerAnswering();
    await answered(opened.id, 5);
    const open = (await threads.read(opened.id)).openDecisions[0];
    if (!open) throw new Error("No Decision was opened.");

    await decisions.answer(open.id, { kind: "option", option: 0 }, ANSWERED_BY_ANN_LEE);
    const log = await answered(opened.id, 7);

    const [session] = engine.sessions;
    expect(engine.sessions).toHaveLength(1);
    const answer = session?.received.find((step) => step.step === "send");
    expect(answer?.step === "send" && answer.message.text).toBe(
      `The user Ann Lee answered your Decision "${EXPORT_QUESTION}" with the option "Only active Projects".`,
    );
    expect(drafts(log).slice(-2)).toEqual([
      { kind: "decision-answer", decisionId: open.id, answer: { kind: "option", option: 0 } },
      { kind: "person", roleKey, text: "Only active ones, then." },
    ]);
    const thread = await threads.read(opened.id);
    expect(thread.openDecisions[0]).toBeUndefined();
    await expect(decisions.listInThread(opened.id)).resolves.toEqual([
      {
        ...open,
        answer: { kind: "option", option: 0, answeredAt: expect.any(Date), user: ANN_LEE },
      },
    ]);
    await expect(decisions.listOpen()).resolves.not.toContainEqual(
      expect.objectContaining({ id: open.id }),
    );
    await expect(decisions.openOn(open.taskId ?? "")).resolves.toBe(0);
    await expect(
      decisions.answer(open.id, { kind: "option", option: 1 }, ANSWERED_BY_ANN_LEE),
    ).rejects.toThrow("This Decision is answered already.");
  });

  it("takes a free answer after a follow-up, in a fresh session briefed with the Task's answered Decisions", async () => {
    await startWith(
      started(
        ...opensDecision("c-1", EXPORT_QUESTION, ["Only active Projects", "Every Project"]),
        ...aTurn("brief", "I asked."),
        sent("answer-1"),
        ...opensDecision("c-2", COLUMNS_QUESTION, ["Every column", "The visible ones"]),
        ...aTurn("answer-1", "One more."),
        sent("follow-up"),
        ...aTurn("follow-up", "The ones the table shows now."),
      ),
      started(...aTurn("brief", "Visible ones plus the id.")),
    );
    const opened = await plannerAnswering();
    await answered(opened.id, 5);
    const first = (await threads.read(opened.id)).openDecisions[0];
    if (!first) throw new Error("No Decision was opened.");
    await decisions.answer(first.id, { kind: "option", option: 0 }, ANSWERED_BY_ANN_LEE);
    await answered(opened.id, 9);

    // A follow-up is an ordinary message: the Decision stays open.
    await runner.send(opened.id, "What does visible mean?", ANN_LEE);
    await answered(opened.id, 11);
    const second = (await threads.read(opened.id)).openDecisions[0];
    expect(second?.question).toBe(COLUMNS_QUESTION);
    await cooled(opened.id, 80_000);

    await runner.answerDecision(
      opened.id,
      second?.id ?? "",
      {
        kind: "free-answer",
        text: "The visible ones, plus the id.",
      },
      ANSWERED_BY_ANN_LEE,
    );
    const log = await answered(opened.id, 14);

    const fresh = engine.sessions[1];
    const brief = fresh?.received[0];
    const text = brief?.step === "start" ? brief.brief.text : "";
    // The Decision answered now is the message's, not the Brief's.
    expect(
      text.endsWith(
        `## Decisions the user answered\n\n- ${EXPORT_QUESTION}\n  Answer: Only active Projects\n\n## The user's message\n\nThe user Ann Lee answered your Decision "${COLUMNS_QUESTION}" in their own words:\n\nThe visible ones, plus the id.`,
      ),
    ).toBe(true);
    expect(text).not.toContain("## Your open Decision");
    expect(drafts(log).slice(-3)).toEqual([
      contextLine({
        move: "fresh",
        reason: "cache-expired",
        contextTokens: 80_000,
        briefTokens: expect.any(Number),
      }),
      {
        kind: "decision-answer",
        decisionId: second?.id,
        answer: { kind: "free-answer", text: "The visible ones, plus the id." },
      },
      { kind: "person", roleKey, text: "Visible ones plus the id." },
    ]);
  });

  it("waits on the user again when the session its answer goes to fails to start, and takes a new answer", async () => {
    await startWith(
      started(
        ...opensDecision("c-1", EXPORT_QUESTION, ["Only active Projects", "Every Project"]),
        ...aTurn("brief", "I asked."),
      ),
      // The engine lists a skill the session wasn't given, so the start check refuses it.
      [{ step: "start", brief: { id: "brief", text: "" }, listedSkills: ["stray"] }],
      started(...aTurn("brief", "Only active ones, then.")),
    );
    const opened = await plannerAnswering();
    await answered(opened.id, 5);
    const open = (await threads.read(opened.id)).openDecisions[0];
    if (!open) throw new Error("No Decision was opened.");
    const before = (await threads.read(opened.id)).session;
    await cooled(opened.id, 80_000);

    await decisions.answer(open.id, { kind: "option", option: 1 }, ANSWERED_BY_ANN_LEE);
    const failed = await waiting(opened.id);

    expect(failed.openDecisions[0]).toEqual(open);
    expect(failed.session?.id).toBe(before?.id);
    await expect(decisions.listOpen()).resolves.toContainEqual(open);
    const log = drafts(await threads.messages(opened.id));
    expect(log.slice(-2)).toEqual([
      { kind: "decision-answer", decisionId: open.id, answer: { kind: "option", option: 1 } },
      { kind: "failure", reason: expect.stringContaining("stray") },
    ]);

    await decisions.answer(open.id, { kind: "option", option: 0 }, ANSWERED_BY_ANN_LEE);
    await vi.waitFor(async () => {
      const thread = await threads.read(opened.id);
      if (thread.state !== "waiting" || thread.openDecisions[0])
        throw new Error("Still answering.");
    });
    const brief = engine.sessions.at(-1)?.received[0];
    expect(brief?.step === "start" && brief.brief.text).toContain(
      `The user Ann Lee answered your Decision "${EXPORT_QUESTION}" with the option "Only active Projects".`,
    );
    expect(drafts(await threads.messages(opened.id)).at(-1)).toEqual({
      kind: "person",
      roleKey,
      text: "Only active ones, then.",
    });
  });

  it("is refused to a session no Thread on a Task has, with the reason the person reads", async () => {
    await startWith(started(...aTurn("brief", "Hello.")));
    const chat = await threads.startInChat(roleKey);
    await runner.send(chat.id, "Hello.", ANN_LEE);
    await answered(chat.id, 3);
    const chatSession = (await threads.read(chat.id)).session?.id ?? "";
    const [tool] = app.get(OfficeToolRegistry).named([OPEN_DECISION_TOOL]);
    const input = {
      question: EXPORT_QUESTION,
      context: "",
      options: ["Only active Projects", "Every Project"],
      recommended: 1,
      why: "It is what the export is for.",
    };

    await expect(tool?.run(input, anOfficeToolCall(chatSession))).resolves.toEqual({
      text: "A Decision is opened on a Task. In your chat, ask the user in your answer instead.",
      isError: true,
    });
    await expect(tool?.run(input, anOfficeToolCall(randomUUID()))).resolves.toEqual({
      text: "The Office doesn't know this session's Thread.",
      isError: true,
    });
  });
});

/** The Planner opens a Decision on one of the Initiative's Tasks, in its planning Thread. */
function opensDecisionOn(
  callId: string,
  taskId: string,
  question: string,
  attachments?: string[],
): Step[] {
  return [
    {
      step: "event",
      event: {
        kind: "tool-call",
        callId,
        tool: OPEN_DECISION_TOOL,
        officeTool: true,
        input: {
          question,
          context: "The exports differ.",
          options: ["CSV", "JSON"],
          recommended: 1,
          why: "Spreadsheets read it.",
          taskId,
          attachments,
        },
        withinToolCall: undefined,
      },
    },
    {
      step: "event",
      event: { kind: "tool-result", callId, text: "", isError: false, withinToolCall: undefined },
    },
  ];
}

const HOLD_TURN = "hold_turn";

/** A call of `HOLD_TURN`, which keeps the turn running until the test lets it go. */
function holdsTheTurn(callId: string): Step[] {
  return [
    {
      step: "event",
      event: {
        kind: "tool-call",
        callId,
        tool: HOLD_TURN,
        officeTool: true,
        input: {},
        withinToolCall: undefined,
      },
    },
    {
      step: "event",
      event: { kind: "tool-result", callId, text: "", isError: false, withinToolCall: undefined },
    },
  ];
}

describe("Decisions in an Initiative's planning Thread", () => {
  it("are several, one per Task; an answer given while the Planner works reaches it as the turn ends, one given while it waits at once", async () => {
    const initiativeId = randomUUID();
    const [taskA, taskB, outside] = [randomUUID(), randomUUID(), randomUUID()];
    initiativeTasks.set(taskA, { initiativeId, title: "Export API" });
    initiativeTasks.set(taskB, { initiativeId, title: "Export button" });
    initiativeOfficeTools = ["read_task", OPEN_DECISION_TOOL, HOLD_TURN];
    await startWith(
      started(
        ...opensDecisionOn("c-1", taskA, "Which format?"),
        ...opensDecisionOn("c-0", taskB, "Which columns?", ["of-another-task"]),
        ...opensDecisionOn("c-2", taskB, "Which columns?"),
        ...opensDecisionOn("c-3", outside, "Outside?"),
        ...holdsTheTurn("c-4"),
        ...aTurn("brief", "Both Tasks left wait for an answer."),
        sent("answers"),
        ...aTurn("answers", "Planned the export API."),
        sent("answer-b"),
        ...aTurn("answer-b", "Planned the export button."),
      ),
    );
    const turn: { letGo?: () => void } = {};
    const held = new Promise<void>((resolve) => {
      turn.letGo = resolve;
    });
    app.get(OfficeToolRegistry).register({
      name: HOLD_TURN,
      description: "Holds the turn.",
      input: z.object({}),
      run: async () => {
        await held;
        return { text: "Done.", isError: false };
      },
    });

    const opened = await threads.startOnInitiative({
      initiativeId,
      roleKey,
      title: "Planning the Initiative",
      opening: "Plan the Initiative's Tasks.",
    });
    const toolResults = () =>
      engine.sessions[0]?.reportedEvents.flatMap((event) =>
        event.kind === "tool-result" ? [event.text] : [],
      ) ?? [];
    // The four open_decision calls have answered; the fifth holds the turn.
    const results = await vi.waitFor(
      () => {
        const reported = toolResults();
        if (reported.length < 4) throw new Error("Not answered yet.");
        return reported;
      },
      { timeout: 5_000, interval: 20 },
    );
    const [onA, onB] = (await threads.read(opened.id)).openDecisions;
    expect(results[0]).toBe(
      `The Decision is open on "Export API", waiting on the user. Plan the Tasks that don't wait for it; end your turn once every Task left waits for an answer. Each answer comes as a message.`,
    );
    expect(results[1]).toContain("of-another-task");
    expect(results[3]).toBe(
      `The Task ${outside} isn't one of this Initiative's Tasks: open the Decision on one of them.`,
    );
    expect([onA?.taskId, onB?.taskId]).toEqual([taskA, taskB]);
    await expect(decisions.openInThread(opened.id)).resolves.toEqual([
      { taskId: taskA, question: "Which format?" },
      { taskId: taskB, question: "Which columns?" },
    ]);

    await decisions.answer(onA?.id ?? "", { kind: "option", option: 0 }, ANSWERED_BY_ANN_LEE);

    const working = await threads.read(opened.id);
    expect(working.state).toBe("answering");
    expect(working.openDecisions.map(({ id }) => id)).toEqual([onB?.id]);
    await expect(decisions.openOn(taskA)).resolves.toBe(0);
    const kept = (await threads.messages(opened.id)).find(
      (line) => line.kind === "decision-answer",
    );
    expect(kept).toMatchObject({ decisionId: onA?.id, delivery: "waiting" });
    const [session] = engine.sessions;
    expect(session?.received.filter(({ step }) => step === "send")).toEqual([]);

    turn.letGo?.();
    await vi.waitFor(
      () => {
        if (!session?.received.some(({ step }) => step === "send"))
          throw new Error("Not handed over yet.");
      },
      { timeout: 5_000, interval: 20 },
    );
    const handedOver = session?.received.find(({ step }) => step === "send");
    expect(handedOver?.step === "send" && handedOver.message.text).toBe(
      `On the Task "Export API" (${taskA}): The user Ann Lee answered your Decision "Which format?" with the option "CSV".`,
    );
    await answered(opened.id, 1);
    const delivered = (await threads.messages(opened.id)).find(
      (line) => line.kind === "decision-answer",
    );
    expect(delivered).toMatchObject({ decisionId: onA?.id, delivery: "delivered" });

    await decisions.answer(onB?.id ?? "", { kind: "option", option: 1 }, ANSWERED_BY_ANN_LEE);
    await vi.waitFor(
      () => {
        const sends = session?.received.filter(({ step }) => step === "send") ?? [];
        if (sends.length < 2) throw new Error("Not yet.");
      },
      { timeout: 5_000, interval: 20 },
    );
    const answeredAtOnce = session?.received.filter(({ step }) => step === "send")[1];
    expect(answeredAtOnce?.step === "send" && answeredAtOnce.message.text).toBe(
      `On the Task "Export button" (${taskB}): The user Ann Lee answered your Decision "Which columns?" with the option "JSON".`,
    );
    await answered(opened.id, 1);
    expect((await threads.read(opened.id)).openDecisions).toEqual([]);
  });
});

/**
 * A chat with the person, its session started, where the user `asking`, Ann Lee unless named, asks
 * them to answer a Decision.
 */
async function aChatWithASession(
  asking: UserRef = ANN_LEE,
): Promise<{ readonly id: string; readonly sessionId: string }> {
  const chat = await threads.startInChat(roleKey);
  await runner.send(chat.id, "Answer it for me: the second option.", asking);
  await answered(chat.id, 3);
  return { id: chat.id, sessionId: (await threads.read(chat.id)).session?.id ?? "" };
}

/** The person answers the Decision for the user with `answer_decision`, from the session. */
async function answersForTheUser(
  sessionId: string,
  input: { readonly decisionId: string; readonly option?: number; readonly answer?: string },
): Promise<{ readonly text: string; readonly isError: boolean } | undefined> {
  const [tool] = app.get(OfficeToolRegistry).named([ANSWER_DECISION_TOOL]);
  return tool?.run(input, anOfficeToolCall(sessionId));
}

/** A Decision opened straight in the Thread, as a consult or The Office's own opens one. */
async function openedInThread(
  threadId: string,
  fields: {
    readonly putTo?: string;
    readonly byTheOffice?: boolean;
    readonly kind?: DecisionKind;
    readonly question?: string;
    readonly options?: readonly string[];
  } = {},
): Promise<Decision> {
  const id = randomUUID();
  await repository.update(threadId, (latest) =>
    openDecision(latest, {
      question: EXPORT_QUESTION,
      context: "Archived Projects have no worktree.",
      options: ["Only active Projects", "Every Project"],
      recommendation: { option: 0, reason: "It is what the export is for." },
      id,
      askedAt: new Date(),
      ...fields,
    }),
  );
  const decision = await repository.decision(id);
  if (!decision) throw new Error("No Decision was opened.");
  return decision;
}

/** Marks the Thread answering, as a turn running there would. */
async function markedAnswering(threadId: string): Promise<void> {
  await repository.update(threadId, (thread) => {
    const answering: Thread = { ...thread, state: "answering" };
    return { thread: answering, logged: [], event: new TurnEnded(answering, new Date()) };
  });
}

/** A Thread on a fresh Task, stored as it is, with no session. */
async function storedThreadOnATask(fields: Partial<Thread> = {}): Promise<Thread> {
  const thread = aThread({
    id: randomUUID(),
    home: { kind: "task", taskId: randomUUID() },
    roleKey,
    ...fields,
  });
  await repository.add(thread);
  return thread;
}

describe("a Decision answered for the user, at their request", () => {
  it("goes from the person's chat into the asking session, recorded as given at the user's request", async () => {
    await startWith(
      started(
        ...opensDecision("c-1", EXPORT_QUESTION, ["Only active Projects", "Every Project"]),
        ...aTurn("brief", "I asked."),
        sent("answer"),
        ...aTurn("answer", "Every Project, then."),
      ),
      started(...aTurn("brief", "I'll answer it.")),
    );
    const opened = await plannerAnswering();
    await answered(opened.id, 5);
    const open = (await threads.read(opened.id)).openDecisions[0];
    if (!open) throw new Error("No Decision was opened.");
    const chat = await aChatWithASession();

    const result = await answersForTheUser(chat.sessionId, { decisionId: open.id, option: 2 });
    const log = await answered(opened.id, 7);

    expect(result).toEqual({
      text: `You answered the Decision "${EXPORT_QUESTION}" for the user Ann Lee: "Every Project". The Office passes it on to whoever waits on it.`,
      isError: false,
    });
    const atUsersRequest = { roleKey, threadId: chat.id, user: ANN_LEE };
    const answer = engine.sessions[0]?.received.find((step) => step.step === "send");
    expect(answer?.step === "send" && answer.message.text).toBe(
      `Jan answered your Decision "${EXPORT_QUESTION}" for the user Ann Lee, at their request, with the option "Every Project".`,
    );
    expect(drafts(log).slice(-2)).toEqual([
      {
        kind: "decision-answer",
        decisionId: open.id,
        answer: { kind: "option", option: 1 },
        atUsersRequest,
      },
      { kind: "person", roleKey, text: "Every Project, then." },
    ]);
    const [stored] = await decisions.listInThread(opened.id);
    expect(stored?.answer).toEqual({
      kind: "option",
      option: 1,
      answeredAt: expect.any(Date),
      atUsersRequest,
    });
    await expect(
      answersForTheUser(chat.sessionId, { decisionId: open.id, option: 1 }),
    ).resolves.toEqual({ text: "This Decision is answered already.", isError: true });
  });

  it("records as the user who asked the one who wrote the latest message in the person's Thread", async () => {
    await startWith(
      started(
        ...opensDecision("c-1", EXPORT_QUESTION, ["Only active Projects", "Every Project"]),
        ...aTurn("brief", "I asked."),
        sent("answer"),
        ...aTurn("answer", "Every Project, then."),
      ),
      started(...aTurn("brief", "I'll answer it.")),
    );
    const opened = await plannerAnswering();
    await answered(opened.id, 5);
    const open = (await threads.read(opened.id)).openDecisions[0];
    if (!open) throw new Error("No Decision was opened.");
    const chat = await aChatWithASession(BEN_ITO);

    const result = await answersForTheUser(chat.sessionId, { decisionId: open.id, option: 2 });
    await answered(opened.id, 7);

    expect(result?.text).toBe(
      `You answered the Decision "${EXPORT_QUESTION}" for the user Ben Ito: "Every Project". The Office passes it on to whoever waits on it.`,
    );
    const answer = engine.sessions[0]?.received.find((step) => step.step === "send");
    expect(answer?.step === "send" && answer.message.text).toBe(
      `Jan answered your Decision "${EXPORT_QUESTION}" for the user Ben Ito, at their request, with the option "Every Project".`,
    );
    expect((await repository.decision(open.id))?.answer?.atUsersRequest).toEqual({
      roleKey,
      threadId: chat.id,
      user: BEN_ITO,
    });
  });

  it("follows the answer rules: an option it doesn't have, a blank answer, and the asker still answering", async () => {
    await startWith(
      started(
        ...opensDecision("c-1", EXPORT_QUESTION, ["Only active Projects", "Every Project"]),
        ...aTurn("brief", "I asked."),
      ),
      started(...aTurn("brief", "I'll answer it.")),
    );
    const opened = await plannerAnswering();
    await answered(opened.id, 5);
    const open = (await threads.read(opened.id)).openDecisions[0];
    if (!open) throw new Error("No Decision was opened.");
    const chat = await aChatWithASession();

    await expect(
      answersForTheUser(chat.sessionId, { decisionId: open.id, option: 3 }),
    ).resolves.toEqual({ text: "Choose one of the Decision's options.", isError: true });
    await expect(
      answersForTheUser(chat.sessionId, { decisionId: open.id, answer: " " }),
    ).resolves.toEqual({ text: "Write your answer first.", isError: true });
    await markedAnswering(opened.id);
    await expect(
      answersForTheUser(chat.sessionId, { decisionId: open.id, option: 1 }),
    ).resolves.toEqual({ text: "Jan is still answering. Answer once they finish.", isError: true });
    expect((await threads.read(opened.id)).openDecisions).toEqual([open]);
  });

  it("refuses one put to a Consultant, an approval, one in the person's own Thread, and one that isn't", async () => {
    await startWith(
      started(
        ...opensDecision("c-1", EXPORT_QUESTION, ["Only active Projects", "Every Project"]),
        ...aTurn("brief", "I asked."),
      ),
      started(...aTurn("brief", "I'll answer it.")),
    );
    const opened = await plannerAnswering();
    await answered(opened.id, 5);
    const own = (await threads.read(opened.id)).openDecisions[0];
    const ownSession = (await threads.read(opened.id)).session?.id ?? "";
    const chat = await aChatWithASession();
    const putToDevops = await openedInThread((await storedThreadOnATask()).id, {
      putTo: "devops",
    });
    const approval = await openedInThread((await storedThreadOnATask()).id, {
      kind: "approval",
      question: approvalQuestion("Install ffmpeg on the machine."),
      options: APPROVAL_OPTIONS,
    });

    await expect(
      answersForTheUser(chat.sessionId, { decisionId: putToDevops.id, option: 1 }),
    ).resolves.toEqual({
      text: "This Decision is put to the person in the Role devops, who answers it in a Consultation; only a Decision waiting on the user can be answered for them.",
      isError: true,
    });
    await expect(
      answersForTheUser(chat.sessionId, { decisionId: approval.id, option: 1 }),
    ).resolves.toEqual({
      text: "This Decision asks the user's approval of a call: only the user gives it, on its card. Tell them where it waits.",
      isError: true,
    });
    await expect(
      answersForTheUser(ownSession, { decisionId: own?.id ?? "", option: 1 }),
    ).resolves.toEqual({
      text: "This Decision is open in your own Thread: the user answers it on its card here, not through you.",
      isError: true,
    });
    const unknown = randomUUID();
    await expect(
      answersForTheUser(chat.sessionId, { decisionId: unknown, option: 1 }),
    ).resolves.toEqual({
      text: `There is no Decision "${unknown}". Read the Task with read_task for the ids of its Decisions waiting on the user.`,
      isError: true,
    });
    await expect(
      answersForTheUser(randomUUID(), { decisionId: unknown, option: 1 }),
    ).resolves.toEqual({ text: "The Office doesn't know this session's Thread.", isError: true });
  });

  it("hands a Stage Thread's Decision and The Office's own to the Pipeline, starting no session", async () => {
    await startWith(started(...aTurn("brief", "I'll answer it.")));
    const chat = await aChatWithASession();
    const inStage = await openedInThread((await storedThreadOnATask({ stageThread: true })).id);
    const officesOwn = await openedInThread((await storedThreadOnATask()).id, {
      byTheOffice: true,
    });

    await answersForTheUser(chat.sessionId, { decisionId: inStage.id, option: 2 });
    await answersForTheUser(chat.sessionId, {
      decisionId: officesOwn.id,
      answer: "Retry the Stage.",
    });

    const atUsersRequest = { roleKey, threadId: chat.id, user: ANN_LEE };
    expect((await repository.decision(inStage.id))?.answer).toEqual({
      kind: "option",
      option: 1,
      answeredAt: expect.any(Date),
      atUsersRequest,
    });
    expect((await repository.decision(officesOwn.id))?.answer).toEqual({
      kind: "free-answer",
      text: "Retry the Stage.",
      answeredAt: expect.any(Date),
      atUsersRequest,
    });
    expect(drafts(await threads.messages(inStage.threadId))).toContainEqual({
      kind: "decision-answer",
      decisionId: inStage.id,
      answer: { kind: "option", option: 1 },
      atUsersRequest,
    });
    expect(engine.sessions).toHaveLength(1);
  });

  it("keeps one given in an Initiative's planning Thread for the turn's end, then hands both answers over", async () => {
    const initiativeId = randomUUID();
    const [taskA, taskB] = [randomUUID(), randomUUID()];
    initiativeTasks.set(taskA, { initiativeId, title: "Export API" });
    initiativeTasks.set(taskB, { initiativeId, title: "Export button" });
    initiativeOfficeTools = ["read_task", OPEN_DECISION_TOOL];
    await startWith(
      started(
        ...opensDecisionOn("c-1", taskA, "Which format?"),
        ...opensDecisionOn("c-2", taskB, "Which columns?"),
        ...aTurn("brief", "Both Tasks wait for an answer."),
        sent("answers"),
        ...aTurn("answers", "Planned both."),
      ),
      started(...aTurn("brief", "I'll answer them.")),
    );
    const opened = await threads.startOnInitiative({
      initiativeId,
      roleKey,
      title: "Planning the Initiative",
      opening: "Plan the Initiative's Tasks.",
    });
    const [onA, onB] = await vi.waitFor(
      async () => {
        const thread = await threads.read(opened.id);
        if (thread.state !== "waiting" || thread.openDecisions.length < 2) {
          throw new Error("Still planning.");
        }
        return thread.openDecisions;
      },
      { timeout: 5_000, interval: 20 },
    );
    const chat = await aChatWithASession();
    await markedAnswering(opened.id);

    await answersForTheUser(chat.sessionId, { decisionId: onB?.id ?? "", option: 2 });

    const atUsersRequest = { roleKey, threadId: chat.id, user: ANN_LEE };
    const kept = (await threads.messages(opened.id)).find(
      (line) => line.kind === "decision-answer",
    );
    expect(kept).toMatchObject({ decisionId: onB?.id, delivery: "waiting", atUsersRequest });
    expect((await repository.decision(onB?.id ?? ""))?.answer).toMatchObject({ atUsersRequest });

    await repository.update(opened.id, (thread) => {
      const idle: Thread = { ...thread, state: "waiting" };
      return { thread: idle, logged: [], event: new TurnEnded(idle, new Date()) };
    });
    await answersForTheUser(chat.sessionId, { decisionId: onA?.id ?? "", option: 1 });
    await answered(opened.id, 1);

    const handedOver = engine.sessions[0]?.received.find(({ step }) => step === "send");
    expect(handedOver?.step === "send" && handedOver.message.text).toBe(
      [
        `On the Task "Export button" (${taskB}): Jan answered your Decision "Which columns?" for the user Ann Lee, at their request, with the option "JSON".`,
        `On the Task "Export API" (${taskA}): Jan answered your Decision "Which format?" for the user Ann Lee, at their request, with the option "CSV".`,
      ].join("\n\n"),
    );
  });
});

describe("a message mentioning records", () => {
  it("briefs a new session with each record, read now, and logs the message as written", async () => {
    await startWith(
      started(
        ...opensDecision("c-1", EXPORT_QUESTION, ["Only active Projects", "Every Project"]),
        ...aTurn("brief", "I asked."),
      ),
      started(...aTurn("brief", "I read them.")),
    );
    const planning = await plannerAnswering();
    await answered(planning.id, 5);
    const decision = (await threads.read(planning.id)).openDecisions[0];
    if (!decision) throw new Error("No Decision was opened.");
    const taskId = randomUUID();
    const ideaId = randomUUID();
    const initiativeId = randomUUID();
    const missingTaskId = randomUUID();
    workRecords.set(taskId, "Export CSV (Task) · Plan: write the exporter.");
    workRecords.set(ideaId, "Dark mode (Idea) · Notes: for the night shift.");
    workRecords.set(initiativeId, "Offline sync (Initiative) · Outcome: writes survive.");
    workRecords.set(
      decision.taskId ?? "",
      "Admin export (Task) · Plan: ask about archived Projects.",
    );
    const chat = await threads.startInChat(roleKey);
    const said = "Compare [@Export CSV](/tasks/x) with [@Dark mode](/work/ideas?idea=y).";

    await runner.send(chat.id, said, ANN_LEE, {
      mentions: [
        { kind: "task", taskId },
        { kind: "idea", ideaId },
        { kind: "decision", decisionId: decision.id },
        { kind: "initiative", initiativeId },
        { kind: "task", taskId: missingTaskId },
      ],
    });
    const log = await answered(chat.id, 3);

    const brief = engine.sessions[1]?.received[0];
    const text = brief?.step === "start" ? brief.brief.text : "";
    expect(text).toMatch(
      /\n\n## Records the user mentioned\n\n[\s\S]+\n\n## The message from the user Ann Lee\n\n/,
    );
    expect(text.endsWith(`## The message from the user Ann Lee\n\n${said}`)).toBe(true);
    const records = text
      .slice(
        text.indexOf("## Records the user mentioned\n\n") + 31,
        text.indexOf("\n\n## The message from the user Ann Lee"),
      )
      .split("\n\n---\n\n");
    expect(records).toHaveLength(5);
    expect(records[0]).toBe("Export CSV (Task) · Plan: write the exporter.");
    expect(records[1]).toBe("Dark mode (Idea) · Notes: for the night shift.");
    expect(records[2]).toContain(`Question: ${EXPORT_QUESTION}`);
    expect(records[2]).toContain("Not answered yet: it waits on the user.");
    expect(records[2]).toContain("Admin export (Task) · Plan: ask about archived Projects.");
    expect(records[3]).toBe("Offline sync (Initiative) · Outcome: writes survive.");
    expect(records[4]).toBe(`The Office has no Task ${missingTaskId}.`);
    // The Thread's context line shows the Brief with the records, as the session got it.
    const [context, message] = drafts(log);
    expect(context?.kind === "context" && context.brief).toContain("## Records the user mentioned");
    expect(message).toEqual({
      kind: "user",
      text: said,
      delivery: "delivered",
      writtenBy: ANN_LEE,
    });
  });

  it("gives a running session the records with the next message", async () => {
    await startWith(started(...aTurn("brief", "Hello."), sent("m-2"), ...aTurn("m-2", "Read it.")));
    const taskId = randomUUID();
    workRecords.set(taskId, "Export CSV (Task) · Plan: write the exporter.");
    const chat = await threads.startInChat(roleKey);
    await runner.send(chat.id, "Hello.", ANN_LEE);
    await answered(chat.id, 3);

    await runner.send(chat.id, "Look at [@Export CSV](/tasks/x).", ANN_LEE, {
      mentions: [{ kind: "task", taskId }],
    });
    const log = await answered(chat.id, 5);

    expect(engine.sessions).toHaveLength(1);
    const next = engine.sessions[0]?.received.find((step) => step.step === "send");
    expect(next?.step === "send" && next.message.text).toBe(
      "Look at [@Export CSV](/tasks/x).\n\n## Records the user mentioned\n\nExport CSV (Task) · Plan: write the exporter.",
    );
    expect(drafts(log)[3]).toEqual({
      kind: "user",
      text: "Look at [@Export CSV](/tasks/x).",
      delivery: "delivered",
      writtenBy: ANN_LEE,
    });
  });
});

describe("a message sent with an Open page", () => {
  const OPEN_PAGE_HEADING = "\n\n## The page the user has open\n\n";

  it("briefs a new session with the Open page's record and keeps it on the message", async () => {
    await startWith(started(...aTurn("brief", "I see Jan.")));
    personRecords.set("planner", "Jan · Planner (Role planner)");
    const chat = await threads.startInChat(roleKey);
    const openPage = { kind: "person", roleKey: "planner" } as const;

    await runner.send(chat.id, "What does this person do?", ANN_LEE, { openPage });
    const log = await answered(chat.id, 3);

    const brief = engine.sessions[0]?.received[0];
    const text = brief?.step === "start" ? brief.brief.text : "";
    expect(text).toContain(
      `${OPEN_PAGE_HEADING}Jan · Planner (Role planner)\n\n## The message from the user Ann Lee`,
    );
    expect(drafts(log)[1]).toEqual({
      kind: "user",
      text: "What does this person do?",
      delivery: "delivered",
      writtenBy: ANN_LEE,
      openPage,
    });
  });

  it("gives a running session the Open page only when it changed since the previous message", async () => {
    await startWith(
      started(
        ...aTurn("brief", "Hello."),
        sent("m-2"),
        ...aTurn("m-2", "Same page."),
        sent("m-3"),
        ...aTurn("m-3", "Another page."),
      ),
    );
    const taskId = randomUUID();
    workRecords.set(taskId, "Export CSV (Task) · Plan: write the exporter.");
    projectRecords.set("admin-panel", "Admin panel (id admin-panel)");
    const chat = await threads.startInChat(roleKey);
    const onTask = { openPage: { kind: "task", taskId } } as const;
    await runner.send(chat.id, "Hello.", ANN_LEE, onTask);
    await answered(chat.id, 3);

    await runner.send(chat.id, "And its tests?", ANN_LEE, onTask);
    await answered(chat.id, 5);
    await runner.send(chat.id, "Where does it publish?", ANN_LEE, {
      openPage: { kind: "project", projectId: "admin-panel" },
    });
    await answered(chat.id, 7);

    expect(engine.sessions).toHaveLength(1);
    const messages = engine.sessions[0]?.received.flatMap((step) =>
      step.step === "send" ? [step.message.text] : [],
    );
    expect(messages).toEqual([
      "And its tests?",
      `Where does it publish?${OPEN_PAGE_HEADING}Admin panel (id admin-panel)`,
    ]);
  });

  it("gives a resumed session the Open page after a message left without one", async () => {
    await startWith(
      started(
        ...aTurn("brief", "Hello."),
        sent("m-2"),
        ...aTurn("m-2", "Nothing open."),
        sent("m-3"),
        ...aTurn("m-3", "Open again."),
      ),
    );
    const taskId = randomUUID();
    workRecords.set(taskId, "Export CSV (Task) · Plan: write the exporter.");
    const chat = await threads.startInChat(roleKey);
    const onTask = { openPage: { kind: "task", taskId } } as const;
    await runner.send(chat.id, "Hello.", ANN_LEE, onTask);
    await answered(chat.id, 3);

    await runner.send(chat.id, "Left out.", ANN_LEE);
    await answered(chat.id, 5);
    await runner.send(chat.id, "Back on it.", ANN_LEE, onTask);
    await answered(chat.id, 7);

    const messages = engine.sessions[0]?.received.flatMap((step) =>
      step.step === "send" ? [step.message.text] : [],
    );
    expect(messages).toEqual([
      "Left out.",
      `Back on it.${OPEN_PAGE_HEADING}Export CSV (Task) · Plan: write the exporter.`,
    ]);
  });

  it("gives a fresh session's Brief the Open page again", async () => {
    await startWith(started(...aTurn("brief", "Hello.")), started(...aTurn("brief", "Fresh.")));
    const ideaId = randomUUID();
    workRecords.set(ideaId, "Dark mode (Idea) · Notes: for the night shift.");
    const chat = await threads.startInChat(roleKey);
    const onIdea = { openPage: { kind: "idea", ideaId } } as const;
    await runner.send(chat.id, "Hello.", ANN_LEE, onIdea);
    await answered(chat.id, 3);

    await threads.chooseOverride(chat.id, "start-fresh");
    await runner.send(chat.id, "Start over.", ANN_LEE, onIdea);
    await answered(chat.id, 6);

    const brief = engine.sessions[1]?.received[0];
    expect(brief?.step === "start" && brief.brief.text).toContain(
      `${OPEN_PAGE_HEADING}Dark mode (Idea) · Notes: for the night shift.`,
    );
  });

  it("gives none in a Task's own Thread, which is about its record already", async () => {
    const taskId = randomUUID();
    workRecords.set(taskId, "Export CSV (Task) · Plan: write the exporter.");
    await startWith(started(...aTurn("brief", "What must be true when it is done?")));
    const opened = await planningThread(taskId);

    await runner.send(opened.id, PLAN_IT, ANN_LEE, { openPage: { kind: "task", taskId } });
    const log = await answered(opened.id, 3);

    const brief = engine.sessions[0]?.received[0];
    expect(brief?.step === "start" && brief.brief.text).not.toContain(
      "## The page the user has open",
    );
    const message = drafts(log).find((draft) => draft.kind === "user");
    expect(message?.kind === "user" && message.openPage).toBeUndefined();
  });

  it("gives no Open page the message mentions already, and words one that is gone", async () => {
    await startWith(started(...aTurn("brief", "Hello."), sent("m-2"), ...aTurn("m-2", "Read it.")));
    const taskId = randomUUID();
    workRecords.set(taskId, "Export CSV (Task) · Plan: write the exporter.");
    const chat = await threads.startInChat(roleKey);
    await runner.send(chat.id, "Hello.", ANN_LEE, {
      openPage: { kind: "person", roleKey: "gone" },
    });
    await answered(chat.id, 3);

    await runner.send(chat.id, "Look at [@Export CSV](/tasks/x).", ANN_LEE, {
      mentions: [{ kind: "task", taskId }],
      openPage: { kind: "task", taskId },
    });
    await answered(chat.id, 5);

    const brief = engine.sessions[0]?.received[0];
    expect(brief?.step === "start" && brief.brief.text).toContain(
      `${OPEN_PAGE_HEADING}The Office has no Role gone.`,
    );
    const next = engine.sessions[0]?.received.find((step) => step.step === "send");
    expect(next?.step === "send" && next.message.text).toBe(
      "Look at [@Export CSV](/tasks/x).\n\n## Records the user mentioned\n\nExport CSV (Task) · Plan: write the exporter.",
    );
  });
});

describe("when a session doesn't answer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs a turn refused for a used-up usage window as its own notice, not a failure, and waits for the user", async () => {
    const resetsAt = new Date("2026-11-13T14:00:00.000Z");
    await startWith(
      started(
        {
          step: "event",
          event: {
            kind: "turn-ended",
            outcome: "usage-window-used-up",
            consumedMessageIds: ["brief"],
            usage: USAGE,
            sessionCostUsd: 0,
            output: undefined,
            errors: ["You've hit your limit · resets 2pm (UTC)"],
            usedUpWindow: { window: "five-hour", resetsAt, resetGiven: true },
          },
        },
        { step: "read-context-usage", usage: { tokens: 32_000, window: WINDOW } },
      ),
    );
    const thread = await threads.startInChat(roleKey);

    await runner.send(thread.id, "Hello.", ANN_LEE);
    await waiting(thread.id);

    const log = drafts(await threads.messages(thread.id));
    expect(log.some((message) => message.kind === "failure")).toBe(false);
    expect(log.at(-1)).toEqual({
      kind: "usage-window-used-up",
      engineName: "Claude Code",
      window: "five-hour",
      resetsAt: "2026-11-13T14:00:00.000Z",
    });
  });

  it("puts back the session the Thread had when a new one fails to start", async () => {
    // No script: the engine refuses to start the session.
    await startWith();
    const thread = await threads.startInChat(roleKey);

    await runner.send(thread.id, "Hello.", ANN_LEE);
    const after = await waiting(thread.id);

    expect(after.session).toBeUndefined();
    expect(drafts(await threads.messages(thread.id)).at(-1)).toMatchObject({ kind: "failure" });
    await expect(app.get(ThreadContexts).of(after)).resolves.toMatchObject({
      move: "fresh",
      reason: "new-thread",
    });
  });

  it("warns in the service log of a session silent after its start, naming its Thread and step, and says when it speaks", async () => {
    const FIRST_EVENT = "the engine gives its first event";
    await startWith(started({ step: "wait", mark: FIRST_EVENT }, ...aTurn("brief", "Here.")));
    const warnings = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const lines = vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    const thread = await threads.startInChat(roleKey);

    await runner.send(thread.id, "Hello.", ANN_LEE);
    await vi.waitFor(() => expect(engine.sessions).toHaveLength(1));
    const [session] = engine.sessions;
    await (app.get(Schedule, { strict: false }) as ManualSchedule).advanceBy(
      SESSION_START_SILENCE_MS,
    );

    expect(lines).toHaveBeenCalledWith(
      `Thread ${thread.id} starts session ${session?.id} on the engine ${FIRST_CLAUDE_CODE_ENGINE.id} for ${PLANNER.name}.`,
    );
    expect(warnings.mock.calls).toEqual([
      [
        `Thread ${thread.id}'s session ${session?.id} (${PLANNER.name}) has given no event 180 s after it was started; it is waiting for the engine's first event.`,
      ],
    ]);
    session?.reach(FIRST_EVENT);
    await answered(thread.id, 3);
    expect(lines).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(`^Thread ${thread.id}'s session ${session?.id} spoke after \\d+ s\\.$`),
      ),
    );
  });

  it("waits for the user again when the session ends before the answer is finished", async () => {
    await startWith(
      started({
        step: "event",
        event: { kind: "text", text: "Let me", withinToolCall: undefined },
      }),
    );
    const thread = await threads.startInChat(roleKey);

    await runner.send(thread.id, "Hello.", ANN_LEE);
    await waiting(thread.id);

    expect(drafts(await threads.messages(thread.id)).slice(2)).toEqual([
      { kind: "person", roleKey, text: "Let me" },
      { kind: "failure", reason: "The session ended before the answer was finished." },
    ]);
  });

  it("recovers a Thread left answering when The Office stopped", async () => {
    // The session waits for a message nobody sends: it is still answering.
    await startWith(started(sent("never")));
    const thread = await threads.startInChat(roleKey);
    await runner.send(thread.id, "Hello.", ANN_LEE);
    // Test files share one database: recovering every Thread would fail those answering in others.
    const answering = repository.answering.bind(repository);
    vi.spyOn(repository, "answering").mockImplementation(async () =>
      (await answering()).filter(({ id }) => id === thread.id),
    );

    const cutShort = await app.get(InterruptedAnswers).recover();

    expect(cutShort).toEqual([thread.id]);
    const after = await threads.read(thread.id);
    expect(after.state).toBe("waiting");
    expect(drafts(await threads.messages(thread.id)).at(-1)).toEqual({
      kind: "failure",
      reason: "The Office stopped while this was being answered.",
    });
  });
});

describe("near the context limit", () => {
  it("asks for a Handover note, ends the session, and continues fresh with the note", async () => {
    await startWith(
      started(
        ...aTurn("brief", "A long answer.", 0.85 * WINDOW),
        sent("handover"),
        ...aTurn("handover", "Deploys read; next: the tests.", 0.86 * WINDOW),
        { step: "end" },
      ),
      started(...aTurn("brief", "Picking up.")),
    );
    const thread = await threads.startInChat(roleKey);
    await runner.send(thread.id, "Read everything.", ANN_LEE);
    const log = await answered(thread.id, 4);

    const [full] = engine.sessions;
    const request = full?.received.find((step) => step.step === "send");
    expect(request?.step === "send" && request.message.text).toBe(HANDOVER_REQUEST);
    expect(drafts(log).at(-1)).toEqual({
      kind: "handover-note",
      roleKey,
      text: "Deploys read; next: the tests.",
    });
    expect((await threads.read(thread.id)).session).toMatchObject({ full: true });

    await runner.send(thread.id, "Go on.", ANN_LEE);
    const after = await answered(thread.id, 7);

    const brief = engine.sessions[1]?.received[0];
    expect(brief?.step === "start" && brief.brief.text).toContain(
      "## Your Handover note\n\nDeploys read; next: the tests.",
    );
    expect(drafts(after)[4]).toMatchObject({
      kind: "context",
      move: "fresh",
      reason: "context-full",
    });
  });
});

/**
 * A sounding of the test's own: lifts are kept by when the alarm sounded, in a table every test
 * file shares.
 */
function aSounding(): { readonly on: true; readonly since: Date } {
  return { on: true, since: new Date(Date.UTC(2026, 9, 29) + randomInt(2 ** 40)) };
}

/** The person calls a chat's Office tool, then answers in words. */
function callsAnOfficeTool(): SessionScript {
  const tool = CHAT_OFFICE_TOOLS[0];
  return started(
    {
      step: "event",
      event: {
        kind: "tool-call",
        callId: "c-1",
        tool,
        officeTool: true,
        input: {},
        withinToolCall: undefined,
      },
    },
    {
      step: "event",
      event: {
        kind: "tool-result",
        callId: "c-1",
        text: "",
        isError: false,
        withinToolCall: undefined,
      },
    },
    ...aTurn("brief", "Here is what I know."),
  );
}

function refusalsIn(log: readonly Message[]): MessageDraft[] {
  return drafts(log).filter(({ kind }) => kind === "refusal");
}

describe("chats during the fire alarm", () => {
  it("lets Agents answer but refuses every tool call, except in a Thread the user lifted it for", async () => {
    await startWith(callsAnOfficeTool(), callsAnOfficeTool());
    const sounded = aSounding();
    app.get(FireAlarmInThreads).readFrom(() => Promise.resolve(sounded));
    const held = await threads.startInChat(roleKey);
    const lifted = await threads.startInChat(roleKey);
    await app.get(FireAlarmLifts).lift(lifted.id);

    await runner.send(held.id, "What changed?", ANN_LEE);
    const heldLog = await answered(held.id, 5);
    await runner.send(lifted.id, "What changed?", ANN_LEE);
    const liftedLog = await answered(lifted.id, 4);

    expect(refusalsIn(heldLog)).toEqual([
      { kind: "refusal", roleKey, tool: CHAT_OFFICE_TOOLS[0], reason: HELD_BY_THE_FIRE_ALARM },
    ]);
    expect(drafts(heldLog).at(-1)).toEqual({
      kind: "person",
      roleKey,
      text: "Here is what I know.",
    });
    expect(refusalsIn(liftedLog)).toEqual([]);
    await expect(app.get(FireAlarmLifts).lifted()).resolves.toEqual([lifted.id]);
  });

  it("keeps a lift until the all clear, refuses one while the alarm is off, and takes one back", async () => {
    await startWith();
    const lifts = app.get(FireAlarmLifts);
    const thread = await threads.startInChat(roleKey);

    await expect(lifts.lift(thread.id)).rejects.toThrow(
      "The fire alarm isn't on: every Agent may act already.",
    );
    const sounded = aSounding();
    const next = aSounding();
    app.get(FireAlarmInThreads).readFrom(() => Promise.resolve(sounded));
    await lifts.lift(thread.id);
    const whileOn = await lifts.heldReason(thread.id);
    app.get(FireAlarmInThreads).readFrom(() => Promise.resolve(next));
    const nextSounding = await lifts.heldReason(thread.id);
    app.get(FireAlarmInThreads).readFrom(() => Promise.resolve(sounded));
    await lifts.takeBack(thread.id);

    expect(whileOn).toBeUndefined();
    expect(nextSounding).toBe(HELD_BY_THE_FIRE_ALARM);
    await expect(lifts.heldReason(thread.id)).resolves.toBe(HELD_BY_THE_FIRE_ALARM);
    await expect(lifts.lifted()).resolves.toEqual([]);
  });
});

/** The lines of the log that say how the Thread's session went. */
function switchLines(log: readonly Message[]): MessageDraft[] {
  return drafts(log).filter(({ kind }) => kind === "context" || kind === "changes-allowed");
}

/**
 * Registers a stand-in for each of `names` no module here registers, as Work, People and Pipelines
 * do.
 */
function standInsFor(names: readonly string[]): void {
  const registry = app.get(OfficeToolRegistry);
  for (const name of names) {
    try {
      registry.named([name]);
    } catch {
      registry.register({
        name,
        description: `Stands in for ${name}.`,
        input: z.object({}),
        run: () => Promise.resolve({ text: "Nothing.", isError: false }),
      });
    }
  }
}

/** Registers a stand-in for an Office action's tool, covered by `coveredBy`. */
function actionStandIn(name: string, coveredBy: readonly string[]): void {
  app.get(OfficeToolRegistry).register({
    name,
    description: `Stands in for ${name}.`,
    input: z.object({}),
    coveredBy,
    run: () => Promise.resolve({ text: "Nothing.", isError: false }),
  });
}

/** The Office tools of the Thread's `index`th session, by name. */
function toolsOf(index: number): readonly string[] | undefined {
  return engine.sessions[index]?.options.officeTools.map(({ name }) => name);
}

describe("a chat's built-in tools, by the duties its person holds", () => {
  it("give a Role under another key holding Default person to talk to the drafting and pointing tools, and calling", async () => {
    duties.set("default-person-to-talk-to", roleKey);
    await startWith(started(...aTurn("brief", "Hello.")));
    standInsFor(chatOfficeTools(["default-person-to-talk-to"]));
    const thread = await threads.startInChat(roleKey);

    await runner.send(thread.id, "Who handles deploys?", ANN_LEE);
    await answered(thread.id, 3);

    expect(toolsOf(0)).toEqual(chatOfficeTools(["default-person-to-talk-to"]));
    expect(toolsOf(0)).toContain(POST_LINK_CARD_TOOL);
    expect(toolsOf(0)).toContain(CONSULT_TOOL);
    expect(toolsOf(0)).not.toContain("create_task");
    expect(engine.sessions[0]?.options.instructions).toContain(CALLING_RULE);
    expect((await threads.read(thread.id)).session?.heldDuties).toEqual([
      "default-person-to-talk-to",
    ]);
  });

  it("give a Role under another key holding Onboards Projects the Project tools and reading a repository", async () => {
    duties.set("onboards-projects", roleKey);
    await startWith(started(...aTurn("brief", "Hello.")));
    standInsFor(chatOfficeTools(["onboards-projects"]));
    const thread = await threads.startInChat(roleKey);

    await runner.send(thread.id, "Onboard this repository.", ANN_LEE);
    await answered(thread.id, 3);

    expect(toolsOf(0)).toEqual(chatOfficeTools(["onboards-projects"]));
    expect(toolsOf(0)).toEqual(
      expect.arrayContaining(["propose_project_commands", READ_REPOSITORY_TOOL, CONSULT_TOOL]),
    );
    expect(engine.sessions[0]?.options.instructions).toContain(
      `Read it only with ${READ_REPOSITORY_TOOL}`,
    );
  });

  it("give a Role under another key holding Shapes Initiatives creating an Initiative", async () => {
    duties.set("shapes-initiatives", roleKey);
    await startWith(started(...aTurn("brief", "Hello.")));
    standInsFor([CREATE_INITIATIVE_TOOL]);
    const thread = await threads.startInChat(roleKey);

    await runner.send(thread.id, "Let's start an Initiative.", ANN_LEE);
    await answered(thread.id, 3);

    expect(toolsOf(0)).toEqual([...CHAT_OFFICE_TOOLS, CREATE_INITIATIVE_TOOL, CONSULT_TOOL]);
  });

  it("give a person the Office actions' tools their held duties cover, after the chat's own, and nobody else", async () => {
    duties.set("shapes-initiatives", roleKey);
    await startWith(started(...aTurn("brief", "Hello.")), started(...aTurn("brief", "Hello.")));
    standInsFor([CREATE_INITIATIVE_TOOL]);
    actionStandIn("take_out_of_initiative", ["shapes-initiatives", "plans"]);
    actionStandIn("onboard_the_project", ["onboards-projects"]);
    const shaper = await threads.startInChat(roleKey);
    await runner.send(shaper.id, "Take the banner out of the sync.", ANN_LEE);
    await answered(shaper.id, 3);

    duties.set("shapes-initiatives", undefined);
    const noLongerShaping = await threads.startInChat(roleKey);
    await runner.send(noLongerShaping.id, "Take the banner out of the sync.", ANN_LEE);
    await answered(noLongerShaping.id, 3);

    expect(toolsOf(0)).toEqual([
      ...CHAT_OFFICE_TOOLS,
      CREATE_INITIATIVE_TOOL,
      CONSULT_TOOL,
      "take_out_of_initiative",
    ]);
    expect(toolsOf(1)).toEqual([...CHAT_OFFICE_TOOLS, CONSULT_TOOL]);
  });

  it("give a person's Thread on a Task the Office actions' tools their duties cover, and a Stage's Thread none", async () => {
    duties.set("plans", roleKey);
    await startWith();
    actionStandIn("add_dependency", ["shapes-initiatives", "plans"]);
    const places = app.get(SessionPlaces);

    const persons = await places.of(await storedThreadOnATask());
    const stages = await places.of(await storedThreadOnATask({ stageThread: true }));

    expect(persons.officeTools).toContain("add_dependency");
    expect(stages.officeTools).not.toContain("add_dependency");
  });

  it("give a Role holding no duty the plain chat's tools, its key the default holder's or not", async () => {
    await startWith(started(...aTurn("brief", "Hello.")));
    const thread = await threads.startInChat(roleKey);

    await runner.send(thread.id, "Hello.", ANN_LEE);
    await answered(thread.id, 3);

    expect(toolsOf(0)).toEqual([...CHAT_OFFICE_TOOLS, CONSULT_TOOL]);
    expect(engine.sessions[0]?.options.instructions).toContain(CALLING_RULE);
    expect((await threads.read(thread.id)).session?.heldDuties).toEqual([]);
  });

  it("start the person fresh with their new tools once a duty moves to them, never resuming the session", async () => {
    await startWith(started(...aTurn("brief", "Hello."), { step: "end" }), [
      { step: "start", brief: { id: "brief", text: "" } },
      ...aTurn("brief", "I onboard Projects now."),
    ]);
    standInsFor(chatOfficeTools(["onboards-projects"]));
    const thread = await threads.startInChat(roleKey);
    await runner.send(thread.id, "Hello.", ANN_LEE);
    await answered(thread.id, 3);

    duties.set("onboards-projects", roleKey);
    await runner.send(thread.id, "Onboard this repository.", ANN_LEE);
    const log = await answered(thread.id, 6);

    expect(engine.sessions).toHaveLength(2);
    expect(engine.sessions[0]?.received.at(-1)).toEqual({ step: "end" });
    expect(toolsOf(0)).not.toContain(READ_REPOSITORY_TOOL);
    expect(toolsOf(1)).toEqual(chatOfficeTools(["onboards-projects"]));
    expect(drafts(log).filter(({ kind }) => kind === "context")).toEqual([
      contextLine({ move: "fresh", reason: "new-thread", briefTokens: expect.any(Number) }),
      contextLine({
        move: "fresh",
        reason: "duties-changed",
        contextTokens: 32_000,
        briefTokens: expect.any(Number),
      }),
    ]);
    expect((await threads.read(thread.id)).session).toMatchObject({
      id: engine.sessions[1]?.id,
      heldDuties: ["onboards-projects"],
    });
  });
});

describe("the Caretaker's chat", () => {
  beforeEach(() => {
    roleKey = CARETAKER;
  });

  it("only reads in a new Thread, a refusal telling the Agent to ask the user to Allow changes", async () => {
    await startWith(started(...aTurn("brief", "The disk is nearly full.")));
    const thread = await threads.startInChat(roleKey);

    await runner.send(thread.id, "Why is the build slow?", ANN_LEE);
    await answered(thread.id, 3);

    expect(engine.sessions[0]?.options).toMatchObject({
      folder: join(officeData, "bases"),
      profile: { edit: false, run: { kind: "read-only-git" }, web: true },
      workstation: false,
      readsEngineTranscripts: true,
      refusalAdvice: ALLOW_CHANGES_ADVICE,
    });
    expect(engine.sessions[0]?.options.instructions).toContain(
      "This Thread only reads until the user allows changes",
    );
    await expect(app.get(AllowChanges).inThread(thread)).resolves.toBe(false);
  });

  it("keeps only the chat's own tools and the set-up while standing in for an unheld Default person to talk to", async () => {
    duties.set("default-person-to-talk-to", undefined);
    await startWith(started(...aTurn("brief", "Nobody greets the user yet.")));
    const thread = await threads.startInChat(roleKey);

    await runner.send(thread.id, "Who do I talk to?", ANN_LEE);
    await answered(thread.id, 3);

    expect(toolsOf(0)).toEqual([...CHAT_OFFICE_TOOLS, CONSULT_TOOL, PROPOSE_OFFICE_SETUP_TOOL]);
    expect(toolsOf(0)).not.toContain(POST_LINK_CARD_TOOL);
    expect(engine.sessions[0]?.options.instructions).toContain(CALLING_RULE);
    expect((await threads.read(thread.id)).session?.heldDuties).toEqual([]);
  });

  it("starts the next session on the workstation once changes are allowed, and only reads again once switched off", async () => {
    await startWith(
      started(...aTurn("brief", "The cache folder is 40 GB."), { step: "end" }),
      started(...aTurn("brief", "Cleared it."), { step: "end" }),
      started(...aTurn("brief", "It is 2 GB now.")),
    );
    const allowChanges = app.get(AllowChanges);
    const thread = await threads.startInChat(roleKey);
    await runner.send(thread.id, "What fills the disk?", ANN_LEE);
    await answered(thread.id, 3);

    await allowChanges.allow(thread.id, ANN_LEE);
    await runner.send(thread.id, "Clear the cache.", ANN_LEE);
    const allowedLog = await answered(thread.id, 7);
    const whileAllowed = await threads.read(thread.id);
    await allowChanges.switchOff(thread.id, ANN_LEE);
    await runner.send(thread.id, "How big is it now?", ANN_LEE);
    const log = await answered(thread.id, 11);

    const [readOnly, onTheWorkstation, readOnlyAgain] = engine.sessions;
    expect(readOnly?.received.at(-1)).toEqual({ step: "end" });
    expect(onTheWorkstation?.options).toMatchObject({
      folder: homedir(),
      profile: { edit: true, run: { kind: "anything" }, web: true },
      workstation: true,
      readsEngineTranscripts: true,
    });
    expect(onTheWorkstation?.options.refusalAdvice).toBeUndefined();
    expect(onTheWorkstation?.options.instructions).toContain("The user allowed changes");
    expect(whileAllowed.session).toMatchObject({ id: onTheWorkstation?.id, changesAllowed: true });
    expect(drafts(allowedLog).at(3)).toEqual({
      kind: "changes-allowed",
      allowed: true,
      by: ANN_LEE,
    });
    expect(onTheWorkstation?.received.at(-1)).toEqual({ step: "end" });
    expect(readOnlyAgain?.options).toMatchObject({
      folder: join(officeData, "bases"),
      workstation: false,
      readsEngineTranscripts: true,
    });
    expect(switchLines(log)).toEqual([
      contextLine({ move: "fresh", reason: "new-thread", briefTokens: expect.any(Number) }),
      { kind: "changes-allowed", allowed: true, by: ANN_LEE },
      contextLine({
        move: "fresh",
        reason: "changes-switched",
        contextTokens: 32_000,
        briefTokens: expect.any(Number),
      }),
      { kind: "changes-allowed", allowed: false, by: ANN_LEE },
      contextLine({
        move: "fresh",
        reason: "changes-switched",
        contextTokens: 32_000,
        briefTokens: expect.any(Number),
      }),
    ]);
  });

  it("holds every call of a session with changes allowed while the fire alarm is on", async () => {
    await startWith(started(...aTurn("brief", "Done.")));
    const thread = await threads.startInChat(roleKey);
    await app.get(AllowChanges).allow(thread.id, ANN_LEE);
    await runner.send(thread.id, "Update the toolchain.", ANN_LEE);
    await answered(thread.id, 4);
    app.get(FireAlarmInThreads).readFrom(() => Promise.resolve(aSounding()));

    await expect(engine.sessions[0]?.options.toolHold?.()).resolves.toBe(HELD_BY_THE_FIRE_ALARM);
  });

  it("starts each new Thread with changes off, and keeps the switch in the Caretaker's chat alone", async () => {
    await startWith();
    const allowChanges = app.get(AllowChanges);
    const allowed = await threads.startInChat(roleKey);
    await allowChanges.allow(allowed.id, ANN_LEE);
    const fresh = await threads.startInChat(roleKey);
    roleKey = `role-${randomUUID()}`;
    const elsewhere = await threads.startInChat(roleKey);

    await expect(allowChanges.inThread(allowed)).resolves.toBe(true);
    await expect(allowChanges.inThread(fresh)).resolves.toBe(false);
    await expect(allowChanges.inThread(elsewhere)).resolves.toBeUndefined();
    await expect(allowChanges.allow(elsewhere.id, ANN_LEE)).rejects.toThrow(
      "Only the Caretaker's chat has Allow changes.",
    );
    await expect(threads.messages(fresh.id)).resolves.toEqual([]);
  });
});

/** A session's options but its holds, which are functions made for each move. */
function withoutHolds(options: object | undefined): object {
  return { ...options, toolHold: undefined, approvalHold: undefined };
}

describe("a Thread's Sub-agents and Processes", () => {
  const SECRET = "s3cret";

  /**
   * A foreground Sub-agent that reports back, then a Process left running across the turn's end.
   */
  const aSubAgentAndAProcess: Step[] = [
    background({
      kind: "sub-agent-started",
      callId: "agent-1",
      engineTaskId: undefined,
      withinToolCall: undefined,
      description: `Look up ${SECRET}`,
      agentKind: "Explore",
      prompt: `Find where ${SECRET} is used.`,
      background: false,
    }),
    background({ kind: "text", text: `I found ${SECRET}.`, withinToolCall: "agent-1" }),
    background({
      kind: "tool-call",
      callId: "grep-1",
      tool: "Grep",
      officeTool: false,
      input: { pattern: SECRET },
      withinToolCall: "agent-1",
    }),
    background({
      kind: "sub-agent-changed",
      callId: "agent-1",
      engineTaskId: "a1",
      background: false,
    }),
    background({
      kind: "sub-agent-ended",
      callId: "agent-1",
      ending: { state: "finished" },
      reportedBack: `It is ${SECRET}.`,
      toolCallCount: 1,
      totalTokens: 900,
    }),
    background({
      kind: "process-started",
      callId: "bash-1",
      engineTaskId: "b1f9c2e07",
      withinToolCall: undefined,
      commandLine: `curl -H "Authorization: Bearer ${SECRET}" localhost`,
      description: "Serve the app",
    }),
    // The secret split across two reads.
    background({ kind: "process-output", callId: "bash-1", text: "ready\nkey=s3" }),
    background({ kind: "process-output", callId: "bash-1", text: "cret\n" }),
  ];

  /** Keeps the session open, its Process running, until the test reaches `SESSION_ENDS`. */
  const SESSION_ENDS = "the session ends";
  const heldOpen: Step[] = [{ step: "wait", mark: SESSION_ENDS }, { step: "end" }];

  async function aMaskedTaskThread(): Promise<Thread> {
    outputMasks.masks.set("admin-panel", {
      mask: (text) => text.replaceAll(SECRET, "[secret]"),
    });
    return planningThread();
  }

  afterEach(() => {
    vi.restoreAllMocks();
    outputMasks.masks.clear();
    for (const session of engine.sessions) session.reach(SESSION_ENDS);
  });

  const REPORTED = "the Sub-agent reports back";

  /** A Sub-agent the Agent leaves running in the background as its turn ends. */
  const aBackgroundSubAgent: Step[] = [
    background({
      kind: "sub-agent-started",
      callId: "agent-1",
      engineTaskId: "a1",
      withinToolCall: undefined,
      description: "Research the launcher",
      agentKind: "general-purpose",
      prompt: "Find how the launcher restarts the service.",
      background: true,
    }),
    ...aTurn("brief", "The research runs; I'll carry on once it reports."),
    { step: "wait", mark: REPORTED },
    background({
      kind: "sub-agent-ended",
      callId: "agent-1",
      ending: { state: "finished" },
      reportedBack: "It restarts it with code 75.",
      toolCallCount: 3,
      totalTokens: 1_200,
    }),
  ];

  it("running in the background count as busy work, by their Thread, and keep its session from its idle end until they have ended", async () => {
    await startWith(started(...aBackgroundSubAgent, { step: "end" }));
    const idleEnds = heldIdleEnds();
    const thread = await planningThread();
    await runner.send(thread.id, PLAN_IT, ANN_LEE);
    await answered(thread.id, 3);
    await vi.waitFor(() => expect(idleEnds).toHaveLength(1));
    const [session] = engine.sessions;

    expect(subAgentsBusy()).toEqual([
      `${PLANNER.name}'s Sub-agents in a Task's Thread, "Planning"`,
    ]);
    idleEnds[0]?.();
    expect(session?.received.some((request) => request.step === "end")).toBe(false);
    expect(subAgentsBusy()).toHaveLength(1);

    session?.reach(REPORTED);
    await vi.waitFor(() => expect(idleEnds).toHaveLength(2));
    expect(subAgentsBusy()).toEqual([]);
    idleEnds[1]?.();
    await vi.waitFor(() =>
      expect(session?.received.some((request) => request.step === "end")).toBe(true),
    );
    expect(await app.get(SubAgentsAndProcesses).list(thread.id)).toMatchObject([
      { callId: "agent-1", ending: { state: "finished" } },
    ]);
  });

  it("running in the background stop counting as busy work once the session ends", async () => {
    await startWith(started(...aBackgroundSubAgent.slice(0, -2), { step: "end" }));
    const thread = await planningThread();
    await runner.send(thread.id, PLAN_IT, ANN_LEE);
    await answered(thread.id, 3);
    await vi.waitFor(() => expect(subAgentsBusy()).toHaveLength(1));

    await runner.endWaiting(thread.home.kind === "task" ? thread.home.taskId : "");

    await vi.waitFor(() => expect(subAgentsBusy()).toEqual([]));
    expect(await app.get(SubAgentsAndProcesses).list(thread.id)).toMatchObject([
      { callId: "agent-1", ending: { state: "stopped", by: "session-end" } },
    ]);
  });

  it("are read back with their states, messages and output, masked, and output between turns is kept and sent live", async () => {
    await startWith(
      started(
        ...aSubAgentAndAProcess,
        ...aTurn("brief", "Started the app."),
        { step: "wait", mark: "between turns" },
        background({ kind: "process-output", callId: "bash-1", text: "GET /\n" }),
        ...heldOpen,
      ),
    );
    const live: DomainEvent[] = [];
    app.get(EventBus).subscribeToEveryEvent((event: DomainEvent) => void live.push(event));
    const kept = app.get(SubAgentsAndProcesses);
    const thread = await aMaskedTaskThread();

    await runner.send(thread.id, PLAN_IT, ANN_LEE);
    await answered(thread.id, 3);
    expect((await kept.output(thread.id, "bash-1", 0)).chunks).toEqual([
      { sequence: 1, text: "ready\n" },
      { sequence: 2, text: "key=[secret]\n" },
    ]);
    engine.sessions[0]?.reach("between turns");

    const output = await vi.waitFor(
      async () => {
        const read = await kept.output(thread.id, "bash-1", 2);
        if (read.lastSequence < 3) throw new Error("No output since the turn's end yet.");
        return read;
      },
      { timeout: 5_000, interval: 20 },
    );
    expect(output).toEqual({
      chunks: [{ sequence: 3, text: "GET /\n" }],
      lastSequence: 3,
      earlierNotKept: 0,
    });
    expect(
      live.filter((event) => event instanceof ProcessOutputKept).map(({ chunk }) => chunk),
    ).toEqual([
      { sequence: 1, text: "ready\n" },
      { sequence: 2, text: "key=[secret]\n" },
      { sequence: 3, text: "GET /\n" },
    ]);
    expect(await kept.list(thread.id)).toMatchObject([
      {
        kind: "sub-agent",
        callId: "agent-1",
        engineTaskId: "a1",
        description: "Look up [secret]",
        agentKind: "Explore",
        prompt: "Find where [secret] is used.",
        ending: { state: "finished" },
        reportedBack: "It is [secret].",
        toolCallCount: 1,
        totalTokens: 900,
        lastSequence: 2,
      },
      {
        kind: "process",
        callId: "bash-1",
        engineTaskId: "b1f9c2e07",
        commandLine: 'curl -H "Authorization: Bearer [secret]" localhost',
        ending: undefined,
      },
    ]);
    expect((await kept.messages(thread.id, "agent-1", 0)).messages).toMatchObject([
      { kind: "text", sequence: 1, text: "I found [secret]." },
      { kind: "tool-activity", sequence: 2, tool: "Grep", summary: "[secret]" },
    ]);
    expect(JSON.stringify(live)).not.toContain(SECRET);
    // A Sub-agent's work stays out of the Thread's own log.
    expect(drafts(await threads.messages(thread.id)).map(({ kind }) => kind)).toEqual([
      "context",
      "user",
      "person",
    ]);
  });

  it("stops what still runs as the session ends, and removes them once a fresh session replaces it", async () => {
    await startWith(
      started(...aSubAgentAndAProcess, ...aTurn("brief", "Started the app."), { step: "end" }),
      started(...aTurn("brief", "Fresh.")),
    );
    const changes: SubAgentOrProcessChanged[] = [];
    app.get(EventBus).subscribe(SubAgentOrProcessChanged, (event) => void changes.push(event));
    const kept = app.get(SubAgentsAndProcesses);
    const thread = await aMaskedTaskThread();
    await runner.send(thread.id, PLAN_IT, ANN_LEE);
    await answered(thread.id, 3);

    await runner.endWaiting(thread.home.kind === "task" ? thread.home.taskId : "");
    await vi.waitFor(async () =>
      expect(await kept.list(thread.id)).toMatchObject([
        { callId: "agent-1", ending: { state: "finished" } },
        { callId: "bash-1", ending: { state: "stopped", by: "session-end" } },
      ]),
    );
    expect(changes.at(-1)).toMatchObject({ change: "ended", item: { callId: "bash-1" } });

    await threads.chooseOverride(thread.id, "start-fresh");
    await runner.send(thread.id, "Start over.", ANN_LEE);
    await answered(thread.id, 6);
    expect(await kept.list(thread.id)).toEqual([]);
    const [first] = engine.sessions;
    // The old session's go only once the fresh one runs, which may answer before they are gone.
    await vi.waitFor(async () =>
      expect(await app.get(SubAgentAndProcessRepository).ofSession(first?.id ?? "")).toEqual([]),
    );
  });

  it("leave a chat's Sub-agent in the background its call asked for, unlike a Stage's", async () => {
    await startWith(
      started(
        background({
          kind: "tool-call",
          callId: "agent-1",
          tool: "Agent",
          officeTool: false,
          input: { prompt: "Review the change.", run_in_background: true },
          withinToolCall: undefined,
        }),
        background({
          kind: "sub-agent-started",
          callId: "agent-1",
          engineTaskId: "a1",
          withinToolCall: undefined,
          description: "Review the change",
          agentKind: "general-purpose",
          prompt: "Review the change.",
          background: true,
        }),
        ...aTurn("brief", "A review runs."),
        ...heldOpen,
      ),
    );
    const thread = await threads.startInChat(roleKey);

    await runner.send(thread.id, "Review the change.", ANN_LEE);
    await answered(thread.id, 3);

    const [session] = engine.sessions;
    expect(session?.options.subAgentsInForeground).toBeUndefined();
    expect(session?.reportedEvents.find(({ kind }) => kind === "tool-call")).toMatchObject({
      input: { run_in_background: true },
    });
    expect(await app.get(SubAgentsAndProcesses).list(thread.id)).toMatchObject([
      { kind: "sub-agent", callId: "agent-1", background: true },
    ]);
  });

  it("stops every one still Running after a restart, as ended when The Office restarted", async () => {
    await startWith(
      started(...aSubAgentAndAProcess, ...aTurn("brief", "Started the app."), ...heldOpen),
    );
    const kept = app.get(SubAgentsAndProcesses);
    const thread = await aMaskedTaskThread();
    await runner.send(thread.id, PLAN_IT, ANN_LEE);
    await answered(thread.id, 3);
    // Test files share one database: stopping every Running one would stop those of others.
    const items = app.get(SubAgentAndProcessRepository);
    const running = items.running.bind(items);
    vi.spyOn(items, "running").mockImplementation(async () =>
      (await running()).filter(({ threadId }) => threadId === thread.id),
    );

    // Only a background Sub-agent lost makes a Thread cut short: these ran in the foreground.
    expect(await kept.recover()).toEqual([]);

    expect(await kept.list(thread.id)).toMatchObject([
      { callId: "agent-1", ending: { state: "finished" } },
      { callId: "bash-1", ending: { state: "stopped", by: "restart" } },
    ]);
  });
});

/** How long a session waits for the next message before it ends (`IDLE_MS`). */
const IDLE_MS = 10 * 60 * 1000;

/** Each idle end the runner arms, held for the test to run instead of the clock. */
function heldIdleEnds(): (() => void)[] {
  const held: (() => void)[] = [];
  const real = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((
    callback: (...args: unknown[]) => void,
    ms?: number,
    ...args: unknown[]
  ) => {
    if (ms !== IDLE_MS) return real(callback, ms, ...args);
    held.push(() => callback());
    return real(() => undefined, 2_147_483_647);
  }) as typeof setTimeout);
  return held;
}

/** The labels of the background Sub-agents a scheduled update would wait for. */
function subAgentsBusy(): readonly string[] {
  return app
    .get(BusyWork)
    .list()
    .filter(({ kind }) => kind === "sub-agents")
    .map(({ label }) => label);
}

function background(event: SessionEvent): Step {
  return { step: "event", event };
}
