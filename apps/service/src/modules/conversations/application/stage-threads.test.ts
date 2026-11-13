import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { z } from "zod";
import { OPEN_DECISION_TOOL, CONSULT_TOOL } from "@the-office/contracts";
import {
  FIRST_CLAUDE_CODE_ENGINE,
  OfficeToolRegistry,
  ScriptedEngine,
  WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL,
  type SessionScript,
  ScriptedEngineModule,
} from "../../engine/index.js";
import { openDecision, answerDecision, startTaskThread } from "../domain/thread-changes.js";
import { DecisionService } from "./decision-service.js";
import { StageDecisions } from "./stage-decisions.js";
import { ThreadRunner } from "./thread-runner.js";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { startTestApplication } from "../../../../test/test-application.js";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../../platform/telemetry/telemetry.module.js";
import { EngineCascade, RoleCards, type SessionRole } from "../../people/index.js";
import { EngineCascadeStandIn } from "../../people/index.fixtures.js";
import { SessionMcpServers, type PreparedMcpServers } from "../../mcp-servers/index.js";
import { SessionSkills } from "../../skills/index.js";
import { DecisionOfficeTools } from "../adapters/office-tools/decision-office-tools.js";
import { Consultations } from "./consultations.js";
import { FireAlarmInThreads } from "./fire-alarm-in-threads.js";
import { PostgresThreadRepository } from "../adapters/postgres/postgres-thread-repository.js";
import { DecisionAnswered, ProcessOutputKept } from "../domain/conversation-events.js";
import type { Message, MessageDraft } from "../domain/message.js";
import { type Thread } from "../domain/thread.js";
import { ProjectBases } from "../ports/project-bases.js";
import { noProjectBases } from "../ports/project-bases.fixtures.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { Briefs } from "./briefs.js";
import { sessionMemoryProvider } from "./session-memory.fixtures.js";
import { aPlannerCard } from "./session-role.fixtures.js";
import { SessionPlaces } from "./session-places.js";
import { CallChains } from "./call-chains.js";
import { StageThreads, type StageThreadRequest } from "./stage-threads.js";
import { TaskTokens } from "./task-tokens.js";
import { InitiativeThreadSetups } from "./initiative-thread-setups.js";
import { TaskThreadSetups } from "./task-thread-setups.js";
import { MentionedRecords } from "./mentioned-records.js";
import { openPageRecordProviders } from "./open-page-records.fixtures.js";
import { WorkRecords } from "./work-records.js";
import { ThreadService } from "./thread-service.js";
import { ContextPolicySettingsService } from "./context-policy-settings.js";
import { ConversationsSettings } from "../ports/conversations-settings.js";
import { ConversationsSettingsForTests } from "../ports/conversations-settings.fixtures.js";
import { OfficeInstructionsRepositoryForTests } from "../ports/office-instructions-repository.fixtures.js";
import { OfficeInstructionsRepository } from "../ports/office-instructions-repository.js";
import { OfficeInstructions } from "./office-instructions.js";
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
import { SubAgentsAndProcesses } from "./sub-agents-and-processes.js";
import { SubAgentAndProcessRepository } from "../ports/sub-agent-and-process-repository.js";
import { PostgresSubAgentAndProcessRepository } from "../adapters/postgres/postgres-sub-agent-and-process-repository.js";

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
  const bases = noProjectBases(join(officeData, "bases"));
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
      CallChains,
      ThreadRunner,
      FireAlarmLifts,
      ApprovalHolds,
      { provide: FireAlarmLiftRepository, useClass: PostgresFireAlarmLiftRepository },
      { provide: ChangesAllowedRepository, useClass: PostgresChangesAllowedRepository },
      MentionedRecords,
      ...openPageRecordProviders(),
      WorkRecords,
      StageThreads,
      {
        provide: SubAgentAndProcessRepository,
        useClass: PostgresSubAgentAndProcessRepository,
      },
      SubAgentsAndProcesses,
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
    event: {
      kind: "tool-result",
      callId,
      text: "Tests pass.",
      isError: false,
      withinToolCall: undefined,
    },
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
    {
      step: "event",
      event: { kind: "tool-result", callId, text: "", isError: false, withinToolCall: undefined },
    },
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

async function startWith(...scripts: SessionScript[]): Promise<void> {
  await startOn(new ScriptedEngine(scripts));
}

describe("StageThreads", () => {
  it("starts a Stage in a new Stage Thread with a Brief of the record and the answered Decisions", async () => {
    await startWith(started(...aTurn({ status: "done" })));
    const ada = aPerson("Ada");
    const request = aStage({ roleKey: ada });
    cascade.set(
      ada,
      { engineId: FIRST_CLAUDE_CODE_ENGINE.id, model: "claude-opus-5-5" },
      request.projectId,
    );
    await anAnsweredDecision(request.taskId, ada);

    const { stageThread, turn } = await aStageRun(request);

    expect(turn).toEqual({ output: { status: "done" }, problem: undefined, tokens: USAGE });
    expect(stageThread.move).toMatchObject({ move: "fresh", reason: "new-thread" });
    const thread = await threadOf(stageThread.threadId);
    expect(thread).toMatchObject({
      home: { kind: "task", taskId: request.taskId },
      roleKey: ada,
      title: "Implement",
      state: "waiting",
      stageThread: true,
      tokens: USAGE,
    });
    const [session] = engine.sessions;
    const opening = session?.received[0];
    const brief = opening?.step === "start" ? opening.brief.text : "";
    expect(brief).toContain("## The Task\n\nRename a device.");
    expect(brief).toContain("Which page shows the rename?\n  Answer: The device page");
    expect(brief.endsWith("## What to do now\n\n## The Stage: Implement\n\nBuild it.")).toBe(true);
    expect(session?.options).toMatchObject({
      folder: request.folder,
      environment: request.environment,
      profile: PROFILE,
      outputSchema: OUTPUT_SCHEMA,
      engine: { id: FIRST_CLAUDE_CODE_ENGINE.id },
      model: "claude-opus-5-5",
    });
    expect(session?.options.instructions).toContain("You are Ada, the Developer");
    expect(session?.options.instructions.endsWith("You work a Stage.")).toBe(true);
    const log = drafts(await repository.messages(thread.id));
    expect(log[0]).toMatchObject({ kind: "context", move: "fresh", reason: "new-thread" });
    expect(log.slice(1)).toEqual([
      { kind: "person", roleKey: ada, text: "Working on it." },
      { kind: "handover-note", roleKey: ada, text: "Left: nothing." },
    ]);
  });

  it("continues the previous Stage's session in its Thread when the same person works the next", async () => {
    await startWith(
      started(...aTurn({ status: "done" })),
      resumed(...aTurn({ status: "done" }, "Reviewing.")),
    );
    const ada = aPerson("Ada");
    const first = await aStageRun(aStage({ roleKey: ada }));

    const second = await aStageRun(
      aStage({
        roleKey: ada,
        stageName: "Review & fix",
        declared: "continue",
        previousThreadId: first.stageThread.threadId,
        work: "## The Stage: Review & fix",
      }),
      "Reviewed.",
    );

    expect(second.stageThread.threadId).toBe(first.stageThread.threadId);
    expect(second.stageThread.move).toMatchObject({ move: "resume", reason: "stage-declared" });
    const [, resumedSession] = engine.sessions;
    expect(resumedSession?.id).toBe(engine.sessions[0]?.id);
    expect(resumedSession?.received[1]).toMatchObject({
      step: "send",
      message: { text: "## The Stage: Review & fix" },
    });
    expect(mcpServers.rebuilt).toEqual([resumedSession?.id]);
    const log = drafts(await repository.messages(first.stageThread.threadId));
    expect(log.slice(3)).toEqual([
      expect.objectContaining({ kind: "context", move: "resume", reason: "stage-declared" }),
      { kind: "person", roleKey: ada, text: "Reviewing." },
      { kind: "handover-note", roleKey: ada, text: "Reviewed." },
    ]);
    expect(forgotten).toEqual([]);
  });

  it("ends the session once, before the Stage's work ends in the Thread", async () => {
    await startWith(started(...aTurn({ status: "done" })));
    const stageThread = await stageThreads.open(aStage({ roleKey: aPerson("Ada") }));
    await stageThread.nextTurn();

    await stageThread.endSession();
    const [session] = engine.sessions;
    expect(session?.received.filter(({ step }) => step === "end")).toHaveLength(1);
    expect((await threadOf(stageThread.threadId)).state).toBe("answering");
    await stageThread.end({ handoverNote: "Left: nothing.", closing: undefined });

    expect(session?.received.filter(({ step }) => step === "end")).toHaveLength(1);
    expect((await threadOf(stageThread.threadId)).state).toBe("waiting");
  });
});

describe("barge-in", () => {
  it("sends the user's message with priority next, and marks it delivered once the turn took it", async () => {
    const command = aCommand("npm-test");
    await startWith(
      started(
        command.call,
        aBargeIn("barge-in"),
        command.result,
        ...aTurn({ status: "done" }, "Renamed it on the list too.", ["brief", "barge-in"]),
      ),
    );
    const ada = aPerson("Ada");
    const stageThread = await stageThreads.open(aStage({ roleKey: ada }));

    const answering = await app
      .get(ThreadRunner)
      .send(stageThread.threadId, "Rename it on the list too.");

    expect(answering.state).toBe("answering");
    expect(await userMessages(stageThread.threadId)).toEqual([
      { kind: "user", text: "Rename it on the list too.", delivery: "waiting" },
    ]);
    const turn = await stageThread.nextTurn();
    expect(turn.output).toEqual({ status: "done" });
    expect(await userMessages(stageThread.threadId)).toEqual([
      { kind: "user", text: "Rename it on the list too.", delivery: "delivered" },
    ]);
    await stageThread.end({ handoverNote: undefined, closing: undefined });
    // One session took it, and no other start or resume: the scripted engine refuses a send of
    // any other priority.
    const steps = engine.sessions.flatMap(({ received }) => received.map(({ step }) => step));
    expect(steps.filter((step) => step !== "read-context-usage")).toEqual(["start", "send", "end"]);
  });
});

describe("Stop", () => {
  it("interrupts the running turn now, which ends interrupted with its tokens counted", async () => {
    const command = aCommand("npm-test");
    await startWith(
      started(command.call, { step: "interrupt" }, anInterruptedTurn, {
        step: "read-context-usage",
        usage: { tokens: 30_000, window: 1_000_000 },
      }),
    );
    const stageThread = await stageThreads.open(aStage({ roleKey: aPerson("Ada") }));
    const turn = stageThread.nextTurn();

    await stageThread.interrupt();

    await expect(turn).resolves.toEqual({
      output: undefined,
      problem: "The turn was interrupted.",
      tokens: USAGE,
    });
    // Between turns there is nothing to stop.
    await stageThread.interrupt();
    await stageThread.end({
      handoverNote: undefined,
      closing: { kind: "held", heldBy: "stop", text: "Stopped by the user." },
    });
    expect(receivedSteps()).toEqual(["start", "interrupt", "end"]);
    expect((await threadOf(stageThread.threadId)).tokens.output).toBe(USAGE.output);
    // The user held the Stage, which is no failure.
    expect(drafts(await repository.messages(stageThread.threadId)).at(-1)).toEqual({
      kind: "held",
      heldBy: "stop",
      text: "Stopped by the user.",
    });
  });

  it("ends the work of a Stage left running as The Office stopped, so its waiting messages go with the next run", async () => {
    await startWith(
      started(aBargeIn("barge-in")),
      // Its session took no turn to its end, so the Context policy starts the next run afresh.
      started(...aTurn({ status: "done" }, "Renamed it on the list instead.", ["brief"])),
    );
    const ada = aPerson("Ada");
    const since = new Date();
    const left = await stageThreads.open(aStage({ roleKey: ada }));
    await stageThreads.bargeIn(left.threadId, "Rename it on the list instead.");
    const failure =
      "The Office restarted during this Stage. The Stage had left no uncommitted edits.";

    const asked = await stageThreads.endLeftRunning(
      left.threadId,
      { kind: "failure", reason: failure },
      since,
    );

    expect(await userMessages(left.threadId)).toEqual([
      { kind: "user", text: "Rename it on the list instead.", delivery: "not-delivered" },
    ]);
    expect(drafts(await repository.messages(left.threadId)).at(-1)).toEqual({
      kind: "failure",
      reason: failure,
    });
    expect((await threadOf(left.threadId)).state).toBe("waiting");
    expect(asked).toBeUndefined();
    // In this process the lost session still runs; a restarted Office would have none.
    await left.endSession();

    const again = await stageThreads.open(
      aStage({
        roleKey: ada,
        declared: undefined,
        previousThreadId: left.threadId,
        carryMessagesSince: since,
      }),
    );
    const begun = engine.sessions[1]?.received.find(({ step }) => step === "start");
    expect(begun).toMatchObject({
      brief: { text: expect.stringContaining("> Rename it on the list instead.") },
    });
    await again.nextTurn();
    await again.end({ handoverNote: undefined, closing: undefined });
  });
});

describe("StageDecisions", () => {
  const draft = {
    question: "Which page?",
    context: "Both list devices.",
    options: ["The device page", "The list"],
    recommendation: { option: 0, reason: "It has the room." },
  };

  it("opens The Office's in a Stage Thread, and takes the answer for the Pipeline with no session", async () => {
    await startWith(started(...aTurn({ status: "needs_decision" })));
    const ada = aPerson("Ada");
    const request = aStage({ roleKey: ada });
    const { stageThread } = await aStageRun(request);
    const answered = answeredEvents();

    const { id } = await app.get(StageDecisions).open({
      taskId: request.taskId,
      threadId: stageThread.threadId,
      draft,
    });
    const thread = await app.get(DecisionService).answer(id, { kind: "option", option: 1 });

    expect(thread.openDecisions[0]).toBeUndefined();
    const log = drafts(await repository.messages(stageThread.threadId));
    expect(log.slice(-2)).toEqual([
      { kind: "decision", roleKey: undefined, decisionId: id },
      { kind: "decision-answer", decisionId: id, answer: { kind: "option", option: 1 } },
    ]);
    expect(answered.map(({ decision }) => [decision.id, decision.answer?.kind])).toEqual([
      [id, "option"],
    ]);
    // The session ended with the Stage; nothing started another.
    expect(engine.sessions).toHaveLength(1);
  });
});

describe("Office tools on a Stage", () => {
  it("open a Decision in the Stage Thread at once, which the Stage reads and the user answers once it ends", async () => {
    await startWith(
      started(
        ...callsOfficeTool("c-1", OPEN_DECISION_TOOL, WHICH_PAGE),
        ...aTurn({ status: "needs_decision", summary: "Asked.", handoverNote: "Waiting." }),
      ),
    );
    const ada = aPerson("Ada");
    const stageThread = await stageThreads.open(anAskingStage(ada));

    await stageThread.nextTurn();
    const asked = await stageThread.askedDecision();

    expect(asked).toEqual({
      id: expect.any(String),
      question: "Which page shows the rename?",
      context: "Both pages list devices.",
      options: ["The device page", "The list"],
      recommendation: { option: 0, reason: "It has the room." },
    });
    const id = asked?.id ?? "";
    await stageThread.end({ handoverNote: "Waiting.", closing: undefined });
    const answered = answeredEvents();

    await app.get(DecisionService).answer(id, { kind: "option", option: 0 });

    expect(answered.map((event) => event.decision.id)).toEqual([id]);
    expect(await repository.decision(id)).toMatchObject({ roleKey: ada, answer: { option: 0 } });
  });

  it("offer write_run_environment_definition only to a Role with the Run environment capability", async () => {
    await startWith(started(...aTurn({ status: "done" })), started(...aTurn({ status: "done" })));
    // Pipelines registers it in the service.
    app.get(OfficeToolRegistry).register({
      name: WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL,
      description: WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL,
      input: z.object({}),
      run: () => Promise.resolve({ text: "", isError: false }),
    });
    const withIt = aPerson("Adam");
    const withoutIt = aPerson("Ada");
    const role = people.get(withIt);
    if (!role) throw new Error("Adam isn't hired.");
    people.set(withIt, {
      ...role,
      card: { ...role.card, capabilities: { ...role.card.capabilities, runEnvironment: true } },
    });

    await aStageRun(aStage({ roleKey: withIt }));
    await aStageRun(aStage({ roleKey: withoutIt }));

    const offered = engine.sessions.map(({ options }) =>
      options.officeTools.map(({ name }) => name),
    );
    expect(offered[0]).toContain(WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL);
    expect(offered[1]).not.toContain(WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL);
  });
});

describe("a Stage Thread's Sub-agents and Processes", () => {
  const BETWEEN_TURNS = "between turns";
  const AFTER_THE_LAST_TURN = "after the last turn";

  it("keeps a Process's output between turns and after the run's last turn, sent live, and stops it with the session", async () => {
    await startWith(
      started(
        reported({
          kind: "process-started",
          callId: "bash-1",
          engineTaskId: "b1f9c2e07",
          withinToolCall: undefined,
          commandLine: "npm run dev",
          description: "Serve the app",
        }),
        reported({
          kind: "sub-agent-started",
          callId: "agent-1",
          engineTaskId: "a1",
          withinToolCall: undefined,
          description: "Review the change",
          agentKind: "general-purpose",
          prompt: "Review it.",
          background: false,
        }),
        reported({ kind: "text", text: "Looks right.", withinToolCall: "agent-1" }),
        ...aTurn({ status: "started" }),
        { step: "wait", mark: BETWEEN_TURNS },
        outputOf("ready\n"),
        reported({
          kind: "sub-agent-ended",
          callId: "agent-1",
          ending: { state: "failed", reason: "Its context window filled." },
          reportedBack: undefined,
          toolCallCount: undefined,
          totalTokens: undefined,
        }),
        { step: "send", message: { id: "work", text: "" }, priority: "later" },
        ...aTurn({ status: "done" }, "Done.", ["work"]),
        { step: "wait", mark: AFTER_THE_LAST_TURN },
        outputOf("GET /\n"),
      ),
    );
    const live: ProcessOutputKept[] = [];
    app.get(EventBus).subscribe(ProcessOutputKept, (kept) => void live.push(kept));
    const kept = app.get(SubAgentsAndProcesses);
    const stageThread = await stageThreads.open(aStage({ roleKey: aPerson("Ada") }));
    const { threadId } = stageThread;
    const [session] = engine.sessions;
    await stageThread.nextTurn();

    session?.reach(BETWEEN_TURNS);
    await vi.waitFor(async () =>
      expect((await kept.output(threadId, "bash-1", 0)).chunks).toEqual([
        { sequence: 1, text: "ready\n" },
      ]),
    );
    await stageThread.send("Go on.", "The Stage goes on.");
    session?.reach(AFTER_THE_LAST_TURN);
    await vi.waitFor(async () =>
      expect((await kept.output(threadId, "bash-1", 1)).chunks).toEqual([
        { sequence: 2, text: "GET /\n" },
      ]),
    );
    expect(live.map(({ where, chunk }) => ({ threadId: where.threadId, ...chunk }))).toEqual([
      { threadId, sequence: 1, text: "ready\n" },
      { threadId, sequence: 2, text: "GET /\n" },
    ]);

    await stageThread.end({ handoverNote: "Left: nothing.", closing: undefined });
    expect(await kept.list(threadId)).toMatchObject([
      { kind: "process", callId: "bash-1", ending: { state: "stopped", by: "session-end" } },
      {
        kind: "sub-agent",
        callId: "agent-1",
        background: false,
        ending: { state: "failed", reason: "Its context window filled." },
        lastSequence: 1,
      },
    ]);
    expect((await kept.messages(threadId, "agent-1", 0)).messages).toMatchObject([
      { kind: "text", sequence: 1, text: "Looks right." },
    ]);
  });

  it("runs a Sub-agent the Agent asks for in the background in the foreground, so it answers before the Stage's result is read", async () => {
    await startWith(
      started(
        reported({
          kind: "tool-call",
          callId: "agent-1",
          tool: "Agent",
          officeTool: false,
          input: {
            description: "Review the change",
            prompt: "Review it.",
            subagent_type: "general-purpose",
            run_in_background: true,
          },
          withinToolCall: undefined,
        }),
        reported({
          kind: "sub-agent-started",
          callId: "agent-1",
          engineTaskId: undefined,
          withinToolCall: undefined,
          description: "Review the change",
          agentKind: "general-purpose",
          prompt: "Review it.",
          background: true,
        }),
        reported({ kind: "text", text: "Looks right.", withinToolCall: "agent-1" }),
        reported({
          kind: "sub-agent-ended",
          callId: "agent-1",
          ending: { state: "finished" },
          reportedBack: "The change is sound.",
          toolCallCount: 3,
          totalTokens: 900,
        }),
        reported({
          kind: "tool-result",
          callId: "agent-1",
          text: "The change is sound.",
          isError: false,
          withinToolCall: undefined,
        }),
        ...aTurn({ status: "done" }, "Reviewed."),
      ),
    );
    const kept = app.get(SubAgentsAndProcesses);
    const stageThread = await stageThreads.open(aStage({ roleKey: aPerson("Ada") }));
    const [session] = engine.sessions;

    const turn = await stageThread.nextTurn();

    expect(session?.options.subAgentsInForeground).toBe(true);
    const kinds = session?.reportedEvents.map(({ kind }) => kind) ?? [];
    expect(kinds.indexOf("sub-agent-ended")).toBeLessThan(kinds.indexOf("turn-ended"));
    expect(session?.reportedEvents.find(({ kind }) => kind === "tool-call")).toMatchObject({
      input: {
        description: "Review the change",
        prompt: "Review it.",
        subagent_type: "general-purpose",
        run_in_background: false,
      },
    });
    expect(turn.output).toEqual({ status: "done" });
    expect(await kept.list(stageThread.threadId)).toMatchObject([
      {
        kind: "sub-agent",
        callId: "agent-1",
        background: false,
        ending: { state: "finished" },
        reportedBack: "The change is sound.",
      },
    ]);
    await stageThread.end({ handoverNote: "Left: nothing.", closing: undefined });
  });
});

function reported(event: Extract<Step, { step: "event" }>["event"]): Step {
  return { step: "event", event };
}

function outputOf(text: string): Step {
  return reported({ kind: "process-output", callId: "bash-1", text });
}

describe("a turn refused for a used-up usage window", () => {
  it("logs the engine's window and its reset as a notice, and hands the refusal to the Stage", async () => {
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
            usedUpWindow: { window: "seven-day", resetsAt, resetGiven: true },
          },
        },
        { step: "read-context-usage", usage: { tokens: 30_000, window: 1_000_000 } },
      ),
    );
    const stageThread = await stageThreads.open(aStage({ roleKey: aPerson("Ada") }));

    const turn = await stageThread.nextTurn();

    expect(turn.usedUpWindow).toEqual({ window: "seven-day", resetsAt });
    expect(drafts(await repository.messages(stageThread.threadId)).at(-1)).toEqual({
      kind: "usage-window-used-up",
      engineName: "Claude Code",
      window: "seven-day",
      resetsAt: "2026-11-13T14:00:00.000Z",
    });
    await stageThread.end({ handoverNote: undefined, closing: undefined });
  });
});
