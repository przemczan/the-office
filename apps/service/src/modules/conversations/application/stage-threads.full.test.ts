import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { z } from "zod";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { CONSULT_TOOL, OPEN_DECISION_TOOL } from "@the-office/contracts";
import {
  EngineModels,
  FIRST_CLAUDE_CODE_ENGINE,
  OfficeToolRegistry,
  ScriptedEngine,
  type SessionScript,
  ScriptedEngineModule,
} from "../../engine/index.js";
import { DEVOPS, EngineCascade, RoleCards, type SessionRole } from "../../people/index.js";
import { type PreparedMcpServers, SessionMcpServers } from "../../mcp-servers/index.js";
import { TokensCounted, DecisionAnswered } from "../domain/conversation-events.js";
import { roleOfficeTools } from "../domain/session-instructions.js";
import { NO_TOKENS, type TokenTotals, type Thread } from "../domain/thread.js";
import {
  chooseOverride,
  openDecision,
  answerDecision,
  startTaskThread,
} from "../domain/thread-changes.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import { DecisionService } from "./decision-service.js";
import { aPlannerCard } from "./session-role.fixtures.js";
import { StageDecisions } from "./stage-decisions.js";
import { type StageThreadRequest, StageThreads } from "./stage-threads.js";
import { TaskTokens } from "./task-tokens.js";
import { ThreadRunner } from "./thread-runner.js";
import { WorkRecords } from "./work-records.js";
import { ThreadService } from "./thread-service.js";
import { storedBeforeOfficeInstructions } from "../domain/thread.fixtures.js";
import { OfficeInstructions } from "./office-instructions.js";
import { anOfficeToolCall } from "../../engine/index.fixtures.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../../platform/telemetry/telemetry.module.js";
import { EngineCascadeStandIn } from "../../people/index.fixtures.js";
import { SessionSkills } from "../../skills/index.js";
import { DecisionOfficeTools } from "../adapters/office-tools/decision-office-tools.js";
import { Consultations } from "./consultations.js";
import { FireAlarmInThreads } from "./fire-alarm-in-threads.js";
import { PostgresThreadRepository } from "../adapters/postgres/postgres-thread-repository.js";
import type { Message, MessageDraft } from "../domain/message.js";
import { ProjectBases } from "../ports/project-bases.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { Briefs } from "./briefs.js";
import { sessionMemoryProvider } from "./session-memory.fixtures.js";
import { SessionPlaces } from "./session-places.js";
import { InitiativeThreadSetups } from "./initiative-thread-setups.js";
import { TaskThreadSetups } from "./task-thread-setups.js";
import { MentionedRecords } from "./mentioned-records.js";
import { openPageRecordProviders } from "./open-page-records.fixtures.js";
import { ContextPolicySettingsService } from "./context-policy-settings.js";
import { ConversationsSettings } from "../ports/conversations-settings.js";
import { ConversationsSettingsForTests } from "../ports/conversations-settings.fixtures.js";
import { OfficeInstructionsRepositoryForTests } from "../ports/office-instructions-repository.fixtures.js";
import { OfficeInstructionsRepository } from "../ports/office-instructions-repository.js";
import { FireAlarmLifts } from "./fire-alarm-lifts.js";
import { ApprovalHolds } from "./approval-holds.js";
import { FireAlarmLiftRepository } from "../ports/fire-alarm-lift-repository.js";
import { PostgresFireAlarmLiftRepository } from "../adapters/postgres/postgres-fire-alarm-lift-repository.js";
import { ChangesAllowedRepository } from "../ports/changes-allowed-repository.js";
import { PostgresChangesAllowedRepository } from "../adapters/postgres/postgres-changes-allowed-repository.js";
import {
  sessionMcpServersStandIn,
  type SessionMcpServersStandIn,
} from "./session-mcp-servers.fixtures.js";
import { ProjectOutputMasks } from "../ports/project-output-masks.js";
import { ProjectOutputMasksForTests } from "../ports/project-output-masks.fixtures.js";

// What stage-threads.test.ts and stage-threads.full.test.ts share: the app each test starts on its scripted engine, and the Stages, turns and people it runs.

const outputMasks = new ProjectOutputMasksForTests();

type Step = SessionScript[number];

const OUTPUT_SCHEMA = { type: "object" };

const PROFILE = { edit: true, run: { kind: "anything" }, web: false, mcpTools: {} } as const;

const USAGE = { input: 3, output: 120, cacheRead: 9_000, cacheCreation: 26_000 };

let app: INestApplication;

let engine: ScriptedEngine;

let officeData: string;

let stageThreads: StageThreads;

let repository: ThreadRepository;

/** The people of this test, by Role key, each under a key of its own. */
let people: Map<string, SessionRole>;

let cascade: EngineCascadeStandIn;

let forgotten: string[];

/** What the MCP servers module stands in for, and the servers it gives new and resumed sessions. */
let mcpServers: SessionMcpServersStandIn;

let mcpServersOnResume: PreparedMcpServers;

const NO_MCP_SERVERS: PreparedMcpServers = { servers: [], leftOut: [] };

/** Who fills the Role, as People would answer. */
function personIn(roleKey: string): Promise<SessionRole> {
  const role = people.get(roleKey);
  if (!role) throw new Error(`Nobody fills ${roleKey}.`);
  return Promise.resolve(role);
}

/** Starts the app on `scripted`, its new sessions given `mcpServersOnStart`. */
async function startOn(
  scripted: ScriptedEngine,
  mcpServersOnStart: PreparedMcpServers = NO_MCP_SERVERS,
): Promise<void> {
  engine = scripted;
  forgotten = [];
  mcpServers = sessionMcpServersStandIn(mcpServersOnStart, mcpServersOnResume);
  const noSkills = (sessionId: string) =>
    Promise.resolve({
      folder: join(officeData, "sessions", sessionId, "skills"),
      names: [],
      expected: [],
      overrides: {},
      versions: [],
      suffixMatches: [],
    });
  const sessionSkills: Pick<SessionSkills, "prepare" | "rebuild" | "forget"> = {
    prepare: ({ sessionId }) => noSkills(sessionId),
    rebuild: noSkills,
    forget: (sessionId) => {
      forgotten.push(sessionId);
      return Promise.resolve();
    },
  };
  const roleCards: Pick<RoleCards, "find" | "forNewSession" | "forResumedSession" | "consultants"> =
    {
      find: (roleKey) => Promise.resolve(people.get(roleKey)),
      consultants: () => Promise.resolve([]),
      forNewSession: personIn,
      forResumedSession: personIn,
    };
  const bases: ProjectBases = {
    folder: join(officeData, "bases"),
    list: () => Promise.resolve([]),
    refresh: () => Promise.resolve([]),
  };
  ({ app } = await startTestApplication({
    database: true,
    imports: [
      EventsModule,
      TelemetryModule,
      OfficeDataModule.forRoot(officeData),
      ScriptedEngineModule.register(engine),
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
      Briefs,
      sessionMemoryProvider(),
      TaskThreadSetups,
      InitiativeThreadSetups,
      SessionPlaces,
      ThreadRunner,
      FireAlarmLifts,
      ApprovalHolds,
      { provide: FireAlarmLiftRepository, useClass: PostgresFireAlarmLiftRepository },
      { provide: ChangesAllowedRepository, useClass: PostgresChangesAllowedRepository },
      MentionedRecords,
      ...openPageRecordProviders(),
      WorkRecords,
      StageThreads,
      StageDecisions,
      DecisionService,
      Consultations,
      FireAlarmInThreads,
      DecisionOfficeTools,
      ThreadService,
      TaskTokens,
    ],
  }));
  stageThreads = app.get(StageThreads);
  repository = app.get(ThreadRepository);
}

function aPerson(name: string): string {
  const roleKey = `role-${randomUUID()}`;
  people.set(roleKey, {
    roleKey,
    cardVersion: 1,
    card: aPlannerCard({ name, title: "Developer", sessionDefault: "always-start-fresh" }),
  });
  return roleKey;
}

function aStage(fields: Partial<StageThreadRequest>): StageThreadRequest {
  return {
    taskId: randomUUID(),
    projectId: "admin-panel",
    roleKey: "unset",
    stageName: "Implement",
    effort: undefined,
    declared: "fresh",
    previousThreadId: undefined,
    carryMessagesSince: undefined,
    record: "## The Task\n\nRename a device.",
    work: "## The Stage: Implement\n\nBuild it.",
    folder: join(officeData, "worktrees", "task"),
    environment: { PROJECT_VARIABLE: "set" },
    useProjectSkills: false,
    projectSkillsOff: [],
    session: {
      instructions: "You work a Stage.",
      profile: PROFILE,
      officeTools: [],
      outputSchema: OUTPUT_SCHEMA,
    },
    ...fields,
  };
}

/** A turn that writes `text` and ends with `output`, having taken the messages `consumed` names. */
function aTurn(output: unknown, text = "Working on it.", consumed: string[] = []): Step[] {
  return [
    { step: "event", event: { kind: "text", text, withinToolCall: undefined } },
    {
      step: "event",
      event: {
        kind: "turn-ended",
        outcome: "completed",
        consumedMessageIds: consumed,
        usage: USAGE,
        sessionCostUsd: 0.01,
        output,
        errors: [],
      },
    },
    { step: "read-context-usage", usage: { tokens: 30_000, window: 1_000_000 } },
  ];
}

const started = (...steps: Step[]): SessionScript => [
  { step: "start", brief: { id: "brief", text: "" } },
  ...steps,
  { step: "end" },
];

const resumed = (...steps: Step[]): SessionScript => [
  { step: "resume" },
  { step: "send", message: { id: "work", text: "" }, priority: "later" },
  ...steps,
  { step: "end" },
];

async function threadOf(id: string): Promise<Thread> {
  const thread = await repository.find(id);
  if (!thread) throw new Error(`No Thread ${id}.`);
  return thread;
}

function drafts(log: readonly Message[]): MessageDraft[] {
  return log.map(({ id: _id, threadId: _threadId, at: _at, ...draft }) => draft);
}

/** Runs a Stage of one turn in its Stage Thread, ending it with `handoverNote`. */
async function aStageRun(request: StageThreadRequest, handoverNote = "Left: nothing.") {
  const stageThread = await stageThreads.open(request);
  const turn = await stageThread.nextTurn();
  await stageThread.end({ handoverNote, closing: undefined });
  return { stageThread, turn };
}

/** A planning Thread on the Task with a Decision the user answered. */
async function anAnsweredDecision(taskId: string, roleKey: string): Promise<void> {
  const { thread } = startTaskThread(
    randomUUID(),
    { taskId, roleKey, title: "Planning" },
    new Date(),
  );
  await repository.add(thread);
  const decisionId = randomUUID();
  await repository.update(thread.id, (latest) =>
    openDecision(latest, {
      id: decisionId,
      askedAt: new Date(),
      question: "Which page shows the rename?",
      context: "Both pages list devices.",
      options: ["The device page", "The list"],
      recommendation: { option: 0, reason: "It has the room." },
    }),
  );
  await repository.update(thread.id, (latest) =>
    answerDecision(latest, {
      personName: "Jan",
      decision: {
        move: "fresh",
        reason: "new-thread",
        cacheWarm: false,
        cacheWarmUntil: undefined,
        contextTokens: 0,
        briefTokens: 1,
        alternatives: [],
      },
      newSession: undefined,
      brief: "",
      decisionId,
      answer: { kind: "option", option: 0 },
      messageId: randomUUID(),
      answeredAt: new Date(),
    }),
  );
}

/** A Bash call the turn makes, whose result comes back once the step after the call is taken. */
const aCommand = (callId: string): { call: Step; result: Step } => ({
  call: {
    step: "event",
    event: {
      kind: "tool-call",
      callId,
      tool: "Bash",
      officeTool: false,
      input: { command: "npm test" },
      withinToolCall: undefined,
    },
  },
  result: {
    step: "event",
    event: { kind: "tool-result", callId, text: "Tests pass.", isError: false },
  },
});

const aBargeIn = (id: string): Step => ({
  step: "send",
  message: { id, text: "" },
  priority: "next",
});

async function userMessages(threadId: string): Promise<MessageDraft[]> {
  return drafts(await repository.messages(threadId)).filter(({ kind }) => kind === "user");
}

const anInterruptedTurn: Step = {
  step: "event",
  event: {
    kind: "turn-ended",
    outcome: "interrupted",
    consumedMessageIds: [],
    usage: USAGE,
    sessionCostUsd: 0.01,
    output: undefined,
    errors: [],
  },
};

function receivedSteps(): string[] {
  return engine.sessions
    .flatMap(({ received }) => received.map(({ step }) => step))
    .filter((step) => step !== "read-context-usage");
}

/** Every DecisionAnswered published from now on. */
function answeredEvents(): DecisionAnswered[] {
  const answered: DecisionAnswered[] = [];
  app.get(EventBus).subscribeToEveryEvent((event: DomainEvent) => {
    if (event instanceof DecisionAnswered) answered.push(event);
  });
  return answered;
}

/** The person calls The Office's tool `tool` with `input`, which answers at once. */
function callsOfficeTool(callId: string, tool: string, input: Record<string, unknown>): Step[] {
  return [
    {
      step: "event",
      event: {
        kind: "tool-call",
        callId,
        tool,
        officeTool: true,
        input,
        withinToolCall: undefined,
      },
    },
    { step: "event", event: { kind: "tool-result", callId, text: "", isError: false } },
  ];
}

/** A Stage whose session is given the Office tools an Agent asks with. */
function anAskingStage(roleKey: string): StageThreadRequest {
  const request = aStage({ roleKey });
  return {
    ...request,
    session: { ...request.session, officeTools: [OPEN_DECISION_TOOL, CONSULT_TOOL] },
  };
}

const WHICH_PAGE = {
  question: "Which page shows the rename?",
  context: "Both pages list devices.",
  options: ["The device page", "The list"],
  recommended: 1,
  why: "It has the room.",
};

/** The hooks every test of both files runs. */
function onTheirOwnApp(): void {
  beforeEach(async () => {
    officeData = await mkdtemp(join(tmpdir(), "office-stage-threads-"));
    people = new Map();
    cascade = new EngineCascadeStandIn();
    mcpServersOnResume = NO_MCP_SERVERS;
  });

  afterEach(async () => {
    await app.close();
    await rm(officeData, { recursive: true, force: true });
  });
}

onTheirOwnApp();

/** The servers the MCP servers module gives new sessions. */
let mcpServersOnStart: PreparedMcpServers;

beforeEach(() => {
  mcpServersOnStart = NO_MCP_SERVERS;
});

async function startWith(...scripts: SessionScript[]): Promise<void> {
  await startOn(new ScriptedEngine(scripts), mcpServersOnStart);
}

/** The same person's next Stage, going on in the Thread `first` ran in. */
function theNextStage(
  roleKey: string,
  first: { readonly stageThread: { readonly threadId: string } },
): StageThreadRequest {
  return aStage({
    roleKey,
    stageName: "Review & fix",
    declared: "continue",
    previousThreadId: first.stageThread.threadId,
    work: "## The Stage: Review & fix",
  });
}

describe("StageThreads", () => {
  it("opens the session on the cascade's model, with the Stage's own effort over the Role card's", async () => {
    await startWith(started(...aTurn({ status: "done" })));
    const ada = aPerson("Ada");
    const request = aStage({ roleKey: ada, effort: "low" });
    cascade.set(
      ada,
      { engineId: FIRST_CLAUDE_CODE_ENGINE.id, model: "claude-haiku-5-5" },
      request.projectId,
    );

    await aStageRun(request);

    expect(engine.sessions[0]?.options).toMatchObject({ model: "claude-haiku-5-5", effort: "low" });
  });

  it("opens the session with its Role's MCP servers on the Project's values, its Brief led by those left out", async () => {
    mcpServersOnStart = {
      servers: [
        {
          name: "github",
          launch: { transport: "streamable-http", url: "https://mcp.example.com", headers: {} },
          tools: [{ name: "list_issues", description: "Lists the issues.", inputSchema: {} }],
        },
      ],
      leftOut: [{ name: "linear", reason: "it has no value for LINEAR_TOKEN." }],
    };
    await startWith(started(...aTurn({ status: "done" })));
    const ada = aPerson("Ada");
    const request = aStage({ roleKey: ada });

    await aStageRun(request);

    const [session] = engine.sessions;
    expect(session?.options.mcpServers).toEqual(mcpServersOnStart.servers);
    expect(mcpServers.prepared).toEqual([
      {
        sessionId: session?.id,
        roleKey: ada,
        projectId: request.projectId,
        workingFolder: request.folder,
      },
    ]);
    const opening = session?.received[0];
    const brief = opening?.step === "start" ? opening.brief.text : "";
    expect(brief.startsWith("## MCP servers left out\n\n")).toBe(true);
    expect(brief).toContain("- linear: it has no value for LINEAR_TOKEN.\n\n");
    expect(brief).toContain("## The Task\n\nRename a device.");
  });

  it("logs each MCP server the session failed to start as a line in the Stage Thread", async () => {
    await startWith(
      started(
        {
          step: "event",
          event: { kind: "mcp-server-not-started", server: "github", reason: "It exited with 1." },
        },
        {
          step: "event",
          event: { kind: "mcp-server-not-started", server: "linear", reason: undefined },
        },
        ...aTurn({ status: "done" }),
      ),
    );
    const ada = aPerson("Ada");

    const { stageThread } = await aStageRun(aStage({ roleKey: ada }));

    const log = drafts(await repository.messages(stageThread.threadId));
    expect(log.slice(1, 4)).toEqual([
      { kind: "mcp-server-not-started", server: "github", reason: "It exited with 1." },
      { kind: "mcp-server-not-started", server: "linear", reason: undefined },
      { kind: "person", roleKey: ada, text: "Working on it." },
    ]);
  });

  it("gives Devops' Stage their own Office tools besides the Stage's, as in their chat", async () => {
    await startWith(started(...aTurn({ status: "done" })));
    people.set(DEVOPS, {
      roleKey: DEVOPS,
      cardVersion: 1,
      card: aPlannerCard({ name: "Nina", title: "Devops", sessionDefault: "always-start-fresh" }),
    });
    // Pipelines and Projects register these in the service.
    const registry = app.get(OfficeToolRegistry);
    for (const name of roleOfficeTools(DEVOPS)) {
      registry.register({
        name,
        description: name,
        input: z.object({}),
        run: () => Promise.resolve({ text: "", isError: false }),
      });
    }

    await aStageRun(aStage({ roleKey: DEVOPS }));

    expect(engine.sessions[0]?.options.officeTools.map(({ name }) => name)).toEqual(
      expect.arrayContaining([...roleOfficeTools(DEVOPS)]),
    );
  });

  describe("the Office instructions", () => {
    it("starts a Stage's session with the current text, before the Role's and the Stage's instructions", async () => {
      await startWith(started(...aTurn({ status: "done" })));
      const ada = aPerson("Ada");
      await app.get(OfficeInstructions).save("Answer in plain words.");

      const { stageThread } = await aStageRun(aStage({ roleKey: ada }));

      const instructions = engine.sessions[0]?.options.instructions ?? "";
      expect(instructions).toMatch(
        /^You are Ada[\s\S]*## Office instructions[\s\S]*Answer in plain words\.[\s\S]*## Your Role's instructions[\s\S]*You work a Stage\.$/,
      );
      expect((await threadOf(stageThread.threadId)).session?.officeInstructionsVersion).toBe(1);
    });

    it("goes on across a change with the version the session recorded", async () => {
      await startWith(
        started(...aTurn({ status: "done" })),
        resumed(...aTurn({ status: "done" }, "Reviewing.")),
      );
      const ada = aPerson("Ada");
      await app.get(OfficeInstructions).save("Answer in plain words.");
      const first = await aStageRun(aStage({ roleKey: ada }));
      await app.get(OfficeInstructions).save("Answer in French.");

      await aStageRun(theNextStage(ada, first), "Reviewed.");

      const [opened, resumedSession] = engine.sessions;
      expect(resumedSession?.id).toBe(opened?.id);
      expect(opened?.options.instructions).toContain("Answer in plain words.");
      expect(resumedSession?.options.instructions).toBe(opened?.options.instructions);
    });

    it("goes on with none in a session stored without a version", async () => {
      await startWith(
        started(...aTurn({ status: "done" })),
        resumed(...aTurn({ status: "done" }, "Reviewing.")),
      );
      const ada = aPerson("Ada");
      await app.get(OfficeInstructions).save("Answer in plain words.");
      const first = await aStageRun(aStage({ roleKey: ada }));
      await repository.update(first.stageThread.threadId, storedBeforeOfficeInstructions);

      await aStageRun(theNextStage(ada, first), "Reviewed.");

      const resumedSession = engine.sessions[1];
      expect(resumedSession?.id).toBe(engine.sessions[0]?.id);
      expect(resumedSession?.options.instructions).not.toContain("Office instructions");
      expect(resumedSession?.options.instructions).not.toContain("Answer in plain words.");
    });

    it("gives a Stage declared fresh the new text, and records its version", async () => {
      await startWith(started(...aTurn({ status: "done" })), started(...aTurn({ status: "done" })));
      const ada = aPerson("Ada");
      await app.get(OfficeInstructions).save("Answer in plain words.");
      const first = await aStageRun(aStage({ roleKey: ada }));
      await app.get(OfficeInstructions).save("Answer in French.");

      const second = await aStageRun(
        aStage({ roleKey: ada, previousThreadId: first.stageThread.threadId }),
      );

      const instructions = engine.sessions[1]?.options.instructions;
      expect(instructions).toContain("Answer in French.");
      expect(instructions).not.toContain("Answer in plain words.");
      const { session } = await threadOf(second.stageThread.threadId);
      expect(session?.officeInstructionsVersion).toBe(2);
    });
  });

  it("lets the Context policy decide when a Stage runs again after its question", async () => {
    await startWith(
      started(...aTurn({ status: "needs_decision" })),
      resumed(...aTurn({ status: "done" }, "Going on.")),
    );
    const ada = aPerson("Ada");
    const first = await aStageRun(aStage({ roleKey: ada }));

    const again = await aStageRun(
      aStage({ roleKey: ada, declared: undefined, previousThreadId: first.stageThread.threadId }),
    );

    expect(again.stageThread.threadId).toBe(first.stageThread.threadId);
    expect(again.stageThread.move).toMatchObject({ move: "resume", reason: "cache-warm" });
  });

  it("tells ahead what the Stage's session would be, as opening it then decides, for the all clear's plan", async () => {
    await startWith(
      started(...aTurn({ status: "needs_decision" })),
      resumed(...aTurn({ status: "done" }, "Going on.")),
    );
    const ada = aPerson("Ada");
    const first = await aStageRun(aStage({ roleKey: ada }));
    const request = aStage({
      roleKey: ada,
      declared: undefined,
      previousThreadId: first.stageThread.threadId,
    });
    const logged = (await repository.messages(first.stageThread.threadId)).length;

    const ahead = await stageThreads.sessionAhead(request);
    const loggedAhead = (await repository.messages(first.stageThread.threadId)).length;
    const opened = await aStageRun(request);

    expect(loggedAhead).toBe(logged);
    expect(ahead).toMatchObject({ move: opened.stageThread.move.move, cacheWarm: true });
    expect(ahead.contextTokens).toBe(opened.stageThread.move.contextTokens);
    expect(ahead.contextTokens).toBeGreaterThan(0);
    expect(ahead.briefTokens).toBeGreaterThan(0);
  });

  it("takes the user's choice in the Thread's context label when the Stage goes on in it, and spends it", async () => {
    await startWith(
      started(...aTurn({ status: "needs_decision" })),
      started(...aTurn({ status: "done" }, "Going on.")),
    );
    const ada = aPerson("Ada");
    const first = await aStageRun(aStage({ roleKey: ada }));
    const threadId = first.stageThread.threadId;
    await repository.update(threadId, (latest) =>
      chooseOverride(latest, "start-fresh", new Date()),
    );

    const again = await aStageRun(
      aStage({ roleKey: ada, declared: undefined, previousThreadId: threadId }),
    );

    expect(again.stageThread.move).toMatchObject({ move: "fresh", reason: "your-choice" });
    expect(again.stageThread.threadId).not.toBe(threadId);
    expect((await threadOf(threadId)).override).toBeUndefined();
  });

  it("starts a Stage declared fresh in a new Thread, even for the same person", async () => {
    await startWith(started(...aTurn({ status: "done" })), started(...aTurn({ status: "done" })));
    const ada = aPerson("Ada");
    const first = await aStageRun(aStage({ roleKey: ada }));

    const second = await aStageRun(
      aStage({ roleKey: ada, previousThreadId: first.stageThread.threadId }),
    );

    expect(second.stageThread.threadId).not.toBe(first.stageThread.threadId);
    expect(second.stageThread.move).toMatchObject({ move: "fresh", reason: "stage-declared" });
    expect(forgotten).toEqual([engine.sessions[0]?.id]);
  });

  it("hands off with a Brief at a Stage of another Role, whatever the Stage declares", async () => {
    await startWith(started(...aTurn({ status: "done" })), started(...aTurn({ status: "done" })));
    const ada = aPerson("Ada");
    const rui = aPerson("Rui");
    const first = await aStageRun(aStage({ roleKey: ada }));

    const second = await aStageRun(
      aStage({
        roleKey: rui,
        stageName: "Review",
        declared: "continue",
        previousThreadId: first.stageThread.threadId,
      }),
    );

    expect(second.stageThread.move).toMatchObject({ move: "hand-off", reason: "another-person" });
    const thread = await threadOf(second.stageThread.threadId);
    expect(thread).toMatchObject({ roleKey: rui, title: "Review", stageThread: true });
    expect(thread.session?.id).not.toBe(engine.sessions[0]?.id);
    const opening = engine.sessions[1]?.received[0];
    expect(opening?.step === "start" && opening.brief.text).toContain("## The Task");
    const [context] = drafts(await repository.messages(thread.id));
    expect(context).toMatchObject({ kind: "context", move: "hand-off", brief: expect.any(String) });
    expect(forgotten).toEqual([engine.sessions[0]?.id]);
  });

  it("sends The Office's message in the same session with why logged, and counts each turn", async () => {
    await startWith(
      started(
        ...aTurn({ status: "maybe" }),
        { step: "send", message: { id: "correction", text: "" }, priority: "later" },
        ...aTurn({ status: "done" }, "Corrected."),
      ),
    );
    const ada = aPerson("Ada");
    const stageThread = await stageThreads.open(aStage({ roleKey: ada }));
    await stageThread.nextTurn();

    const corrected = await stageThread.send("Correct it.", "The result was invalid.");
    await stageThread.end({
      handoverNote: undefined,
      closing: { kind: "failure", reason: "It failed anyway." },
    });

    expect(corrected.output).toEqual({ status: "done" });
    const thread = await threadOf(stageThread.threadId);
    expect(thread.tokens.output).toBe(USAGE.output * 2);
    expect(drafts(await repository.messages(thread.id)).slice(2)).toEqual([
      { kind: "failure", reason: "The result was invalid." },
      { kind: "person", roleKey: ada, text: "Corrected." },
      { kind: "failure", reason: "It failed anyway." },
    ]);
  });

  it("tells each turn's tokens, which count toward the Task's budgets", async () => {
    await startWith(started(...aTurn({ status: "done" })));
    const request = aStage({ roleKey: aPerson("Ada") });
    await anAnsweredDecision(request.taskId, aPerson("Jan"));

    const { turn } = await aStageRun(request);

    expect(turn.tokens).toEqual(USAGE);
    // Counted without cache reads.
    expect(await app.get(TaskTokens).budgetTokensSoFar(request.taskId)).toBe(3 + 120 + 26_000);
    // The Stage Threads alone, by the engine id their sessions spend on.
    expect(await app.get(TaskTokens).stageTokensSoFar(request.taskId)).toEqual([
      { engineId: "claude-code", tokens: 3 + 120 + 26_000 },
    ]);
  });

  it("refuses the user's messages in a Stage Thread once its Stage has ended", async () => {
    await startWith(started(...aTurn({ status: "done" })));
    const { stageThread } = await aStageRun(aStage({ roleKey: aPerson("Ada") }));

    await expect(app.get(ThreadRunner).send(stageThread.threadId, "Hello?")).rejects.toThrow(
      ThreadRefused,
    );
  });
});

describe("barge-in", () => {
  it("reads the turn the engine starts with a message the running turn ended before taking", async () => {
    const command = aCommand("npm-test");
    await startWith(
      started(
        command.call,
        aBargeIn("barge-in"),
        command.result,
        ...aTurn({ status: "done" }, "Done.", ["brief"]),
        ...aTurn({ status: "done", list: true }, "Renamed it on the list too.", ["barge-in"]),
      ),
    );
    const stageThread = await stageThreads.open(aStage({ roleKey: aPerson("Ada") }));
    await stageThreads.bargeIn(stageThread.threadId, "Rename it on the list too.");

    const turn = await stageThread.nextTurn();

    expect(turn.output).toEqual({ status: "done", list: true });
    expect(turn.tokens.output).toBe(USAGE.output * 2);
    expect(await userMessages(stageThread.threadId)).toEqual([
      { kind: "user", text: "Rename it on the list too.", delivery: "delivered" },
    ]);
    await stageThread.end({ handoverNote: undefined, closing: undefined });
  });

  it("holds a message written between turns until The Office sends its next one", async () => {
    await startWith(
      started(
        ...aTurn({ status: "maybe" }),
        { step: "send", message: { id: "correction", text: "" }, priority: "later" },
        aBargeIn("barge-in"),
        ...aTurn({ status: "done" }, "Corrected.", ["correction", "barge-in"]),
      ),
    );
    const stageThread = await stageThreads.open(aStage({ roleKey: aPerson("Ada") }));
    await stageThread.nextTurn();

    // Sent now, it would start a turn the Stage would read as the correction's answer.
    await stageThreads.bargeIn(stageThread.threadId, "Rename it on the list too.");
    const corrected = await stageThread.send("Correct it.", "The result was invalid.");

    expect(corrected.output).toEqual({ status: "done" });
    expect(await userMessages(stageThread.threadId)).toEqual([
      { kind: "user", text: "Rename it on the list too.", delivery: "delivered" },
    ]);
    await stageThread.end({ handoverNote: undefined, closing: undefined });
  });

  it("marks a message not delivered when the Stage's session ends first, and refuses any after", async () => {
    await startWith(started(...aTurn({ status: "done" })));
    const stageThread = await stageThreads.open(aStage({ roleKey: aPerson("Ada") }));
    await stageThread.nextTurn();
    await stageThreads.bargeIn(stageThread.threadId, "Rename it on the list too.");

    await stageThread.endSession();

    expect(await userMessages(stageThread.threadId)).toEqual([
      { kind: "user", text: "Rename it on the list too.", delivery: "not-delivered" },
    ]);
    await expect(stageThreads.bargeIn(stageThread.threadId, "And the page?")).rejects.toThrow(
      ThreadRefused,
    );
    await stageThread.end({ handoverNote: undefined, closing: undefined });
  });
});

/** The running turn's tokens so far, as the engine reports them mid-turn. */
const soFar = (output: number): Step => ({
  step: "event",
  event: { kind: "turn-tokens", soFar: { input: 3, output, cacheRead: 9_000, cacheCreation: 0 } },
});

describe("a Stage Thread's tokens", () => {
  it("count the running turn as it goes, and take the turn's own count as it ends", async () => {
    await startWith(started(soFar(40), soFar(90), ...aTurn({ status: "done" })));
    const counted: { readonly tokens: TokenTotals; readonly running: TokenTotals }[] = [];
    app.get(EventBus).subscribeToEveryEvent((event: DomainEvent) => {
      if (event instanceof TokensCounted) {
        counted.push({ tokens: event.thread.tokens, running: event.thread.runningTurnTokens });
      }
    });

    const { stageThread, turn } = await aStageRun(aStage({ roleKey: aPerson("Ada") }));

    expect(counted).toEqual([
      { tokens: NO_TOKENS, running: { input: 3, output: 40, cacheRead: 9_000, cacheCreation: 0 } },
      { tokens: NO_TOKENS, running: { input: 3, output: 90, cacheRead: 9_000, cacheCreation: 0 } },
    ]);
    expect(await threadOf(stageThread.threadId)).toMatchObject({
      tokens: USAGE,
      runningTurnTokens: NO_TOKENS,
    });
    expect(turn.tokens).toEqual(USAGE);
  });
});

describe("Stop", () => {
  it("ends the session instead on an engine that can't interrupt", async () => {
    const command = aCommand("npm-test");
    await startOn(new ScriptedEngine([started(command.call)], { interrupt: false }));
    const stageThread = await stageThreads.open(aStage({ roleKey: aPerson("Ada") }));
    const turn = stageThread.nextTurn();

    await stageThread.interrupt();

    await expect(turn).rejects.toThrow("The session ended before the Stage's turn did.");
    await stageThread.end({
      handoverNote: undefined,
      closing: { kind: "held", heldBy: "stop", text: "Stopped by the user." },
    });
    expect(receivedSteps()).toEqual(["start", "end"]);
  });

  it("interrupts a turn whose engine was removed while it ran, as it finishes on the old engine", async () => {
    const command = aCommand("npm-test");
    await startWith(
      started(command.call, { step: "interrupt" }, anInterruptedTurn, {
        step: "read-context-usage",
        usage: { tokens: 30_000, window: 1_000_000 },
      }),
    );
    const stageThread = await stageThreads.open(aStage({ roleKey: aPerson("Ada") }));
    const turn = stageThread.nextTurn();
    vi.spyOn(app.get(EngineModels), "engines").mockResolvedValue([]);

    await stageThread.interrupt();

    await expect(turn).resolves.toMatchObject({ problem: "The turn was interrupted." });
    expect(receivedSteps()).toEqual(["start", "interrupt"]);
  });

  it("carries the user's message the stopped session never took into the Stage's next run, delivered once a turn takes it", async () => {
    const command = aCommand("npm-test");
    await startWith(
      started(command.call, aBargeIn("barge-in"), { step: "interrupt" }, anInterruptedTurn, {
        step: "read-context-usage",
        usage: { tokens: 30_000, window: 1_000_000 },
      }),
      resumed(...aTurn({ status: "done" }, "Renamed it on the list instead.", ["work"])),
    );
    const ada = aPerson("Ada");
    const since = new Date();
    const stopped = await stageThreads.open(aStage({ roleKey: ada }));
    const turn = stopped.nextTurn();
    await stageThreads.bargeIn(stopped.threadId, "Rename it on the list instead.");
    await stopped.interrupt();
    await turn;
    await stopped.end({
      handoverNote: undefined,
      closing: { kind: "held", heldBy: "stop", text: "Stopped by the user." },
    });
    expect(await userMessages(stopped.threadId)).toEqual([
      { kind: "user", text: "Rename it on the list instead.", delivery: "not-delivered" },
    ]);

    const again = await stageThreads.open(
      aStage({
        roleKey: ada,
        declared: undefined,
        previousThreadId: stopped.threadId,
        carryMessagesSince: since,
      }),
    );
    const sent = engine.sessions[1]?.received.find(({ step }) => step === "send");
    expect(sent).toMatchObject({
      message: {
        text: expect.stringContaining(
          "## The user's messages\n\nThe user wrote these to you while the Stage ran; they hadn't reached you when it was held. Act on them:\n\n> Rename it on the list instead.",
        ),
      },
    });
    expect(await userMessages(stopped.threadId)).toEqual([
      { kind: "user", text: "Rename it on the list instead.", delivery: "waiting" },
    ]);

    await again.nextTurn();

    expect(again.threadId).toBe(stopped.threadId);
    expect(await userMessages(stopped.threadId)).toEqual([
      { kind: "user", text: "Rename it on the list instead.", delivery: "delivered" },
    ]);
    await again.end({ handoverNote: undefined, closing: undefined });
  });

  it("carries nothing written before the held run began", async () => {
    await startWith(
      started(...aTurn({ status: "done" })),
      resumed(...aTurn({ status: "done" }, "Done.", ["work"])),
    );
    const ada = aPerson("Ada");
    const earlier = await stageThreads.open(aStage({ roleKey: ada }));
    await earlier.nextTurn();
    await stageThreads.bargeIn(earlier.threadId, "An old message.");
    await earlier.end({ handoverNote: undefined, closing: undefined });

    await stageThreads.open(
      aStage({
        roleKey: ada,
        declared: undefined,
        previousThreadId: earlier.threadId,
        carryMessagesSince: new Date(Date.now() + 60_000),
      }),
    );

    const sent = engine.sessions[1]?.received.find(({ step }) => step === "send");
    expect(sent).toMatchObject({ message: { text: "## The Stage: Implement\n\nBuild it." } });
    expect(await userMessages(earlier.threadId)).toEqual([
      { kind: "user", text: "An old message.", delivery: "not-delivered" },
    ]);
  });
});

describe("StageDecisions", () => {
  const draft = {
    question: "Which page?",
    context: "Both list devices.",
    options: ["The device page", "The list"],
    recommendation: { option: 0, reason: "It has the room." },
  };

  it("opens The Office's own in the Task's newest Thread, asked by no person", async () => {
    await startWith();
    const taskId = randomUUID();
    await anAnsweredDecision(taskId, aPerson("Jan"));
    const [planning] = await repository.listIn({ kind: "task", taskId });

    const { id } = await app.get(StageDecisions).open({
      taskId,
      threadId: undefined,
      draft,
    });
    const opened = await repository.decision(id);
    await app.get(DecisionService).answer(id, { kind: "free-answer", text: "Mock the clock." });

    expect(opened).toMatchObject({ threadId: planning?.id, roleKey: undefined });
    expect((await repository.decision(id))?.answer).toMatchObject({ kind: "free-answer" });
    // The Office's answers guide the walk, not the next Brief.
    expect(await repository.answeredOn(taskId)).toHaveLength(1);
  });
});

/** Calls the Office tool as the Stage Thread's session would, outside a scripted turn. */
async function callInStage(threadId: string, name: string, input: Record<string, unknown>) {
  const sessionId = (await threadOf(threadId)).session?.id ?? "";
  const [tool] = app.get(OfficeToolRegistry).named([name]);
  if (!tool) throw new Error(`No Office tool ${name}.`);
  return tool.run(tool.input.parse(input), anOfficeToolCall(sessionId));
}

describe("Office tools on a Stage", () => {
  it("know the person and the Task of a Stage's session, as they know a chat's", async () => {
    await startWith(started(...aTurn({ status: "done" })));
    const ada = aPerson("Ada");
    const request = aStage({ roleKey: ada });
    const { stageThread } = await aStageRun(request);
    const sessionId = (await threadOf(stageThread.threadId)).session?.id ?? "";

    const threads = app.get(ThreadService);

    await expect(threads.personInSession(sessionId)).resolves.toBe(ada);
    await expect(threads.taskInSession(sessionId)).resolves.toBe(request.taskId);
  });

  it("open a Decision naming the Task's Attachments, and refuse one from another record", async () => {
    await startWith(started(...aTurn({ status: "done" })));
    const request = anAskingStage(aPerson("Ada"));
    const [screenshot, report, ofAnotherTask] = [randomUUID(), randomUUID(), randomUUID()];
    app.get(WorkRecords).provide({
      taskRecord: () => Promise.resolve(undefined),
      taskTitle: () => Promise.resolve(undefined),
      taskAttachmentIds: (taskId) =>
        Promise.resolve(taskId === request.taskId ? [screenshot, report] : [ofAnotherTask]),
      initiativeRecord: () => Promise.resolve(undefined),
      ideaRecord: () => Promise.resolve(undefined),
    });
    const { stageThread } = await aStageRun(request);
    const { threadId } = stageThread;

    const refused = await callInStage(threadId, OPEN_DECISION_TOOL, {
      ...WHICH_PAGE,
      attachments: [screenshot, ofAnotherTask],
    });

    expect(refused).toEqual({
      text: `A Decision names Attachments of its own Task only, and these aren't: ${ofAnotherTask}.`,
      isError: true,
    });
    expect((await threadOf(threadId)).openDecision).toBeUndefined();

    const opened = await callInStage(threadId, OPEN_DECISION_TOOL, {
      ...WHICH_PAGE,
      attachments: [screenshot, report],
    });

    expect(opened.isError).toBe(false);
    const decision = (await threadOf(threadId)).openDecision;
    expect(decision?.attachmentIds).toEqual([screenshot, report]);
    expect(await repository.decision(decision?.id ?? "")).toMatchObject({
      attachmentIds: [screenshot, report],
    });
  });

  it("take the user's answer while the Stage still runs, and the Stage still reads the Decision", async () => {
    await startWith(
      started(
        ...callsOfficeTool("c-1", OPEN_DECISION_TOOL, WHICH_PAGE),
        ...aTurn({ status: "needs_decision", summary: "Asked." }),
      ),
    );
    const stageThread = await stageThreads.open(anAskingStage(aPerson("Ada")));
    await stageThread.nextTurn();
    const id = (await threadOf(stageThread.threadId)).openDecision?.id ?? "";
    const answered = answeredEvents();

    await app.get(DecisionService).answer(id, { kind: "option", option: 1 });

    expect(answered.map((event) => event.decision.id)).toEqual([id]);
    // Answered before the Stage's run keeps it: the Pipeline reads the answer as it would wait.
    await expect(stageThread.askedDecision()).resolves.toMatchObject({ id });
    await expect(app.get(StageDecisions).answerOf(id)).resolves.toEqual({
      kind: "option",
      option: 1,
    });
    await stageThread.end({ handoverNote: undefined, closing: undefined });
  });

  it("let the Agent open another once the Stage runs again in its Thread after the answer", async () => {
    await startWith(
      started(
        ...callsOfficeTool("c-1", OPEN_DECISION_TOOL, WHICH_PAGE),
        ...aTurn({ status: "needs_decision", summary: "Asked." }),
      ),
      resumed(
        ...callsOfficeTool("c-2", OPEN_DECISION_TOOL, { ...WHICH_PAGE, question: "Which label?" }),
        ...aTurn({ status: "needs_decision", summary: "Asked again." }, "Going on."),
      ),
    );
    const request = anAskingStage(aPerson("Ada"));
    const first = await stageThreads.open(request);
    await first.nextTurn();
    const earlier = await first.askedDecision();
    await first.end({ handoverNote: undefined, closing: undefined });
    await app.get(DecisionService).answer(earlier?.id ?? "", { kind: "option", option: 1 });

    const again = await stageThreads.open({
      ...request,
      declared: undefined,
      previousThreadId: first.threadId,
    });
    await again.nextTurn();
    const asked = await again.askedDecision();
    await again.end({ handoverNote: undefined, closing: undefined });

    expect(again.threadId).toBe(first.threadId);
    expect(asked).toMatchObject({ question: "Which label?" });
    expect(asked?.id).not.toBe(earlier?.id);
  });

  it("keep a Decision open when the Stage's work ends held, and tell of it for a run left running", async () => {
    await startWith(
      started(
        ...callsOfficeTool("c-1", OPEN_DECISION_TOOL, WHICH_PAGE),
        ...aTurn({ status: "needs_decision", summary: "Asked." }),
      ),
    );
    const since = new Date();
    const left = await stageThreads.open(anAskingStage(aPerson("Ada")));
    await left.nextTurn();

    const asked = await stageThreads.endLeftRunning(
      left.threadId,
      { kind: "failure", reason: "The Office restarted during this Stage." },
      since,
    );

    expect(asked).toMatchObject({ question: "Which page shows the rename?" });
    expect((await threadOf(left.threadId)).openDecision?.id).toBe(asked?.id);
    await expect(
      stageThreads.endLeftRunning(
        left.threadId,
        { kind: "failure", reason: "Again." },
        new Date(Date.now() + 1_000),
      ),
    ).resolves.toBeUndefined();
  });

  it("consult a person with a question: the user answers in their place, on a Decision naming them", async () => {
    await startWith(started(...aTurn({ status: "done" })));
    const { stageThread } = await aStageRun(anAskingStage(aPerson("Ada")));

    const result = await callInStage(stageThread.threadId, CONSULT_TOOL, {
      person: "Devops",
      question: "May the build cache live in the Project's folder?",
      context: "It speeds the build up by a minute.",
      options: ["Yes", "No"],
      recommended: 1,
      why: "It stays inside the worktree.",
    });

    expect(result).toEqual({
      text: "The Office put your consult to the user in place of Devops, as a Decision in this Thread. End your turn now: their answer, or a follow-up question, comes as your next message.",
      isError: false,
    });
    expect((await threadOf(stageThread.threadId)).openDecision).toMatchObject({
      question: "May the build cache live in the Project's folder?",
      context:
        "For Devops: nobody who can be consulted fills that Role, so you answer in their place.\n\nIt speeds the build up by a minute.",
      options: ["Yes", "No"],
      recommendation: { option: 0, reason: "It stays inside the worktree." },
    });
  });

  it("consult a person for approval of a call, answered Allow once or Deny, never always", async () => {
    await startWith(started(...aTurn({ status: "done" })));
    const { stageThread } = await aStageRun(anAskingStage(aPerson("Ada")));

    await callInStage(stageThread.threadId, CONSULT_TOOL, {
      person: "Devops",
      approval: true,
      question: "Install ffmpeg on the machine.",
      context: "The thumbnails need it; the Project has no copy.",
      why: "Nothing else makes the thumbnails.",
    });

    expect((await threadOf(stageThread.threadId)).openDecision).toMatchObject({
      question: "Allow this call? Install ffmpeg on the machine.",
      options: ["Allow once", "Deny"],
      recommendation: { option: 0, reason: "Nothing else makes the thumbnails." },
    });
  });

  it("consult the user directly for approval, as a Hard switch set to Ask me says, naming nobody", async () => {
    await startWith(started(...aTurn({ status: "done" })));
    const { stageThread } = await aStageRun(anAskingStage(aPerson("Ada")));

    const result = await callInStage(stageThread.threadId, CONSULT_TOOL, {
      approval: true,
      question: "Push the branch to a fork.",
      context: "The reviewer wants to try it.",
      why: "They can't reach the workstation.",
    });

    expect(result).toEqual({
      text: "The Office put your consult to the user, as a Decision in this Thread. End your turn now: their answer, or a follow-up question, comes as your next message.",
      isError: false,
    });
    expect((await threadOf(stageThread.threadId)).openDecision).toMatchObject({
      question: "Allow this call? Push the branch to a fork.",
      context: "The reviewer wants to try it.",
      options: ["Allow once", "Deny"],
    });
  });

  it("refuse a consult with a question but no options, in words the Agent can act on", async () => {
    await startWith(started(...aTurn({ status: "done" })));
    const { stageThread } = await aStageRun(anAskingStage(aPerson("Ada")));

    const result = await callInStage(stageThread.threadId, CONSULT_TOOL, {
      person: "the CTO",
      question: "Which queue?",
      context: "Two would do.",
      why: "Either works.",
    });

    expect(result).toEqual({
      text: "Give the user at least two options. Recommend one of the options.",
      isError: true,
    });
    expect((await threadOf(stageThread.threadId)).openDecision).toBeUndefined();
  });
});
