import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { ContractMessageImageRules } from "../adapters/http/contract-message-image-rules.js";
import { MessageImageRules } from "../ports/message-image-rules.js";
import { MessageImages } from "./message-images.js";
import { ThreadImages } from "./thread-images.js";
import { MessageImagesInMemory } from "./message-images.fixtures.js";
import { z } from "zod";
import { OPEN_DECISION_TOOL, CONSULT_TOOL, PROPOSE_BUG_TASK_TOOL } from "@the-office/contracts";
import {
  EngineModels,
  FIRST_CLAUDE_CODE_ENGINE,
  OfficeToolRegistry,
  ScriptedEngine,
  WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL,
  type SessionScript,
  ScriptedEngineModule,
} from "../../engine/index.js";
import {
  BUG_TASK_OPTIONS,
  oneOptionAnswer,
  type BugTaskFields,
  type DecisionAnswer,
} from "../domain/decision.js";
import { stageAnswerOf } from "../domain/stage-answer.js";
import { ProposalRefused } from "../domain/proposal-refused.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import type { UserRef } from "../domain/user.js";
import {
  BugTaskOfficeTools,
  BUG_TASK_DECISION_OPENED,
} from "../adapters/office-tools/bug-task-office-tools.js";
import { BugTaskDecisions } from "./bug-task-decisions.js";
import { ProposalAppliers } from "./proposal-appliers.js";
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
import { ScheduleModule } from "../../../platform/schedule/schedule.module.js";
import { OfficeDataModule } from "../../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../../platform/telemetry/telemetry.module.js";
import { EngineCascade, RoleCards, type SessionRole } from "../../people/index.js";
import { BusyWorkModule } from "../../office-updates/index.js";
import { EngineCascadeStandIn } from "../../people/index.fixtures.js";
import { SessionMcpServers, type PreparedMcpServers } from "../../mcp-servers/index.js";
import { SessionSkills } from "../../skills/index.js";
import { skillCommandsProvider } from "./skill-commands.fixtures.js";
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
import { dutiesProvider } from "./duties.fixtures.js";
import { aPlannerCard } from "./session-role.fixtures.js";
import { SessionPlaces } from "./session-places.js";
import { CallChains } from "./call-chains.js";
import { StageThreads, type StageThread, type StageThreadRequest } from "./stage-threads.js";
import { SwitchFailed } from "../domain/switch-failed.js";
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
import { MCP_TOOL_DEFAULT_STAND_IN } from "../../people/index.fixtures.js";
import { ANN_LEE, ANSWERED_BY_ANN_LEE } from "../domain/user.fixtures.js";
import { ConversationsPromptTemplatesForTests } from "../adapters/prompt-templates/conversations-prompt-templates.fixtures.js";

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

/** The images the tests' messages carry, as Work keeps them. */
let messageImages: MessageImagesInMemory;

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

/**
 * Starts the app on `scripted`, its new sessions given `mcpServersOnStart`; with `fallback`, that
 * one plays the Claude Code engines on its fallback adapter (`claudeCodeP`), as a Stand-in Engine.
 */
async function startOn(
  scripted: ScriptedEngine,
  mcpServersOnStart: PreparedMcpServers = NO_MCP_SERVERS,
  fallback?: ScriptedEngine,
): Promise<void> {
  engine = scripted;
  forgotten = [];
  mcpServers = sessionMcpServersStandIn(mcpServersOnStart, mcpServersOnResume);
  const noSkills = (sessionId: string) =>
    Promise.resolve({
      folder: join(officeData, "sessions", sessionId, "skills"),
      names: [],
      expected: [],
      userOnly: [],
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
      ConversationsPromptTemplatesForTests,
      EventsModule,
      ScheduleModule,
      BusyWorkModule,
      TelemetryModule,
      OfficeDataModule.forRoot(officeData),
      ScriptedEngineModule.register(
        fallback
          ? {
              "agent-sdk": engine,
              "claude-code-p": fallback,
              "openai-compatible-api": engine,
              codex: engine,
              "copilot-cli": engine,
              "gemini-cli": engine,
            }
          : engine,
      ),
    ],
    providers: [
      { provide: ThreadRepository, useClass: PostgresThreadRepository },
      { provide: RoleCards, useValue: roleCards },
      { provide: EngineCascade, useValue: cascade },
      { provide: ProjectBases, useValue: bases },
      { provide: ProjectOutputMasks, useValue: outputMasks },
      { provide: SessionSkills, useValue: sessionSkills },
      skillCommandsProvider(),
      { provide: SessionMcpServers, useValue: mcpServers.service },
      { provide: ConversationsSettings, useValue: new ConversationsSettingsForTests() },
      { provide: OfficeInstructionsRepository, useClass: OfficeInstructionsRepositoryForTests },
      OfficeInstructions,
      ContextPolicySettingsService,
      Briefs,
      MessageImages,
      ThreadImages,
      { provide: MessageImageRules, useClass: ContractMessageImageRules },
      sessionMemoryProvider(),
      dutiesProvider(),
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
      ProposalAppliers,
      BugTaskDecisions,
      BugTaskOfficeTools,
      ThreadService,
      TaskTokens,
    ],
  }));
  stageThreads = app.get(StageThreads);
  repository = app.get(ThreadRepository);
  messageImages = new MessageImagesInMemory();
  app.get(MessageImages).provide(messageImages);
}

function aPerson(name: string): string {
  const roleKey = `role-${randomUUID()}`;
  people.set(roleKey, {
    roleKey,
    cardVersion: 1,
    mcpToolDefault: MCP_TOOL_DEFAULT_STAND_IN,
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
    initiativeId: undefined,
    stageRun: 1,
    pipelineName: "Feature",
    projectName: "Admin panel",
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
    engineStandIns: [],
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
      context: "Both pages list devices.",
      questions: [
        {
          kind: "choice",
          question: "Which page shows the rename?",
          options: ["The device page", "The list"],
          recommendation: { option: 0, reason: "It has the room." },
        },
      ],
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
      answer: oneOptionAnswer(0),
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

const WHICH_PAGE_QUESTION = {
  question: "Which page shows the rename?",
  options: ["The device page", "The list"],
  recommended: 1,
  why: "It has the room.",
};

const WHICH_PAGE = { context: "Both pages list devices.", questions: [WHICH_PAGE_QUESTION] };

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

    expect(turn).toEqual({
      output: { status: "done" },
      problem: undefined,
      tokens: USAGE,
      context: { tokens: 30_000, window: 1_000_000 },
    });
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
    expect(brief).toContain("- Which page shows the rename?\n  Answer: The device page");
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
      .send(stageThread.threadId, "Rename it on the list too.", ANN_LEE);

    expect(answering.state).toBe("answering");
    expect(await userMessages(stageThread.threadId)).toEqual([
      { kind: "user", text: "Rename it on the list too.", delivery: "waiting", writtenBy: ANN_LEE },
    ]);
    const turn = await stageThread.nextTurn();
    expect(turn.output).toEqual({ status: "done" });
    expect(await userMessages(stageThread.threadId)).toEqual([
      {
        kind: "user",
        text: "Rename it on the list too.",
        delivery: "delivered",
        writtenBy: ANN_LEE,
      },
    ]);
    await stageThread.end({ handoverNote: undefined, closing: undefined });
    // One session took it, and no other start or resume: the scripted engine refuses a send of
    // any other priority.
    const steps = engine.sessions.flatMap(({ received }) => received.map(({ step }) => step));
    expect(steps.filter((step) => step !== "read-context-usage")).toEqual(["start", "send", "end"]);
  });

  it("sends the images the user's message carries with it, kept on the Task", async () => {
    await startWith(
      started(
        aBargeIn("barge-in"),
        ...aTurn({ status: "done" }, "Matched the mock-up.", ["brief", "barge-in"]),
      ),
    );
    const request = aStage({ roleKey: aPerson("Ada") });
    const stageThread = await stageThreads.open(request);
    const image = await messageImages.keep({ kind: "task", taskId: request.taskId }, "mock-up.png");

    await app
      .get(ThreadRunner)
      .send(stageThread.threadId, "Like this.", ANN_LEE, { images: [image.attachmentId] });
    await stageThread.nextTurn();

    const barged = engine.sessions[0]?.received.find((step) => step.step === "send");
    expect(barged?.step === "send" && barged.message.images).toEqual([
      { name: "mock-up.png", mediaType: "image/png", size: 4 },
    ]);
    expect(await userMessages(stageThread.threadId)).toEqual([
      {
        kind: "user",
        text: "Like this.",
        delivery: "delivered",
        writtenBy: ANN_LEE,
        images: [{ attachmentId: image.attachmentId, name: "mock-up.png", mediaType: "image/png" }],
      },
    ]);
    await stageThread.end({ handoverNote: undefined, closing: undefined });
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
      context: { tokens: 30_000, window: 1_000_000 },
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
    await stageThreads.bargeIn(left.threadId, "Rename it on the list instead.", ANN_LEE);
    const failure =
      "The Office restarted during this Stage. The Stage had left no uncommitted edits.";

    const asked = await stageThreads.endLeftRunning(
      left.threadId,
      { kind: "failure", reason: failure },
      since,
    );

    expect(await userMessages(left.threadId)).toEqual([
      {
        kind: "user",
        text: "Rename it on the list instead.",
        delivery: "not-delivered",
        writtenBy: ANN_LEE,
      },
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

  it("carries the images of a message that never landed into the Stage's next run", async () => {
    await startWith(
      started(aBargeIn("barge-in")),
      started(...aTurn({ status: "done" }, "Matched the mock-up.", ["brief"])),
    );
    const ada = aPerson("Ada");
    const since = new Date();
    const request = aStage({ roleKey: ada });
    const left = await stageThreads.open(request);
    const image = await messageImages.keep({ kind: "task", taskId: request.taskId }, "mock-up.png");
    const sent = { attachmentId: image.attachmentId, name: "mock-up.png", mediaType: "image/png" };
    await stageThreads.bargeIn(left.threadId, "Like this.", ANN_LEE, [sent]);
    await stageThreads.endLeftRunning(left.threadId, { kind: "failure", reason: "Lost." }, since);
    await left.endSession();

    const again = await stageThreads.open(
      aStage({
        ...request,
        declared: undefined,
        previousThreadId: left.threadId,
        carryMessagesSince: since,
      }),
    );

    const begun = engine.sessions[1]?.received.find(({ step }) => step === "start");
    expect(begun).toMatchObject({
      brief: {
        text: expect.stringContaining(
          `> Like this.\n> image mock-up.png · Attachment ${image.attachmentId}`,
        ) as string,
        images: [{ name: "mock-up.png", mediaType: "image/png", size: 4 }],
      },
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
    const thread = await app
      .get(DecisionService)
      .answer(id, oneOptionAnswer(1), ANSWERED_BY_ANN_LEE);

    expect(thread.openDecisions[0]).toBeUndefined();
    const log = drafts(await repository.messages(stageThread.threadId));
    expect(log.slice(-2)).toEqual([
      { kind: "decision", roleKey: undefined, decisionId: id },
      { kind: "decision-answer", decisionId: id, answer: oneOptionAnswer(1) },
    ]);
    expect(answered.map(({ decision }) => [decision.id, decision.answer?.kind])).toEqual([
      [id, "submitted"],
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

    await app.get(DecisionService).answer(id, oneOptionAnswer(0), ANSWERED_BY_ANN_LEE);

    expect(answered.map((event) => event.decision.id)).toEqual([id]);
    expect(await repository.decision(id)).toMatchObject({
      roleKey: ada,
      answer: { kind: "submitted", answers: [{ kind: "option", option: 0 }] },
    });
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

/** A bug-task Decision's answer: the option chosen, with any other fields. */
const answered = (option: number, fields: Partial<DecisionAnswer> = {}): DecisionAnswer =>
  ({ kind: "submitted", answers: [{ kind: "option", option }], ...fields }) as DecisionAnswer;

describe("propose_bug_task on a Stage", () => {
  const PROPOSED = {
    title: "Two token refreshes at once sign The Office out of GitHub",
    description: "**Steps to reproduce**\n1. Open Pull requests and CI at once",
    why: "The token refresh runs twice. It is outside this Task.",
    causedBy: "cause-task",
  };

  /** What Work was asked to create, and how it answers. */
  let created: {
    task: BugTaskFields;
    foundWhileWorkingOn: string;
    createdBy: UserRef | null;
  }[];
  let refusal: string[] | undefined;
  /** How long Work takes to create a Task, in ms. */
  let creatingFor: number;

  /** Work's applier as a stand-in: the Stage's Task is in admin-panel, and api is a Project too. */
  function withWork(stageTaskId: string): void {
    created = [];
    refusal = undefined;
    creatingFor = 0;
    app.get(ProposalAppliers).registerBugTask({
      projectOf: (taskId) => Promise.resolve(taskId === stageTaskId ? "admin-panel" : undefined),
      problemsWith: ({ projectId }) =>
        Promise.resolve(
          ["admin-panel", "api"].includes(projectId) ? [] : [`There is no Project "${projectId}".`],
        ),
      create: async (task, foundWhileWorkingOn, createdBy) => {
        if (creatingFor > 0) await new Promise((resolve) => setTimeout(resolve, creatingFor));
        if (refusal) throw new ProposalRefused(refusal);
        created.push({ task, foundWhileWorkingOn, createdBy });
        return { id: "bug-task", title: task.title };
      },
    });
  }

  /** An Agent Stage that proposes a Bug Task, then ends needing the Decision. */
  async function aProposingStage(input: Record<string, unknown> = PROPOSED) {
    await startWith(
      started(
        ...callsOfficeTool("c-1", PROPOSE_BUG_TASK_TOOL, input),
        ...aTurn({ status: "needs_decision", summary: "Proposed.", handoverNote: "Waiting." }),
      ),
    );
    const request = aStage({ roleKey: aPerson("Kai") });
    withWork(request.taskId);
    const stageThread = await stageThreads.open({
      ...request,
      session: { ...request.session, officeTools: [PROPOSE_BUG_TASK_TOOL] },
    });
    await stageThread.nextTurn();
    const asked = await stageThread.askedDecision();
    await stageThread.end({ handoverNote: "Waiting.", closing: undefined });
    return { request, asked };
  }

  it("opens a bug-task Decision on the Agent's Task, which the Stage waits on and nobody dismisses", async () => {
    const { request, asked } = await aProposingStage();

    expect(asked).toMatchObject({
      question: `Create the Bug Task "${PROPOSED.title}"?`,
      context: PROPOSED.why,
      options: [...BUG_TASK_OPTIONS],
    });
    const id = asked?.id ?? "";
    expect(await repository.decision(id)).toMatchObject({
      kind: "bug-task",
      taskId: request.taskId,
      inStageThread: true,
      bugTask: { ...PROPOSED, projectId: "admin-panel" },
    });
    await expect(
      app.get(DecisionService).answer(id, { kind: "dismissed" }, ANSWERED_BY_ANN_LEE),
    ).rejects.toThrow("A proposed Bug Task can't be dismissed");
  });

  it("creates the Bug Task as edited, found while working on the Task, and tells the Agent its link", async () => {
    const { request, asked } = await aProposingStage();
    const id = asked?.id ?? "";
    const edited = {
      title: "Concurrent token refreshes sign The Office out",
      description: PROPOSED.description,
      projectId: "api",
      causedBy: "cause-task",
    };

    await app
      .get(BugTaskDecisions)
      .answer(
        id,
        answered(0, { bugTask: edited, createdTaskId: "forged" } as Partial<DecisionAnswer>),
        ANSWERED_BY_ANN_LEE,
      );

    expect(created).toEqual([
      { task: edited, foundWhileWorkingOn: request.taskId, createdBy: ANN_LEE },
    ]);
    const decision = await repository.decision(id);
    expect(decision?.answer).toMatchObject({ bugTask: edited, createdTaskId: "bug-task" });
    expect(decision && stageAnswerOf(decision)).toEqual({
      kind: "free-answer",
      text: "Created the Bug Task [Concurrent token refreshes sign The Office out](/tasks/bug-task) (Task bug-task), in Backlog, found while working on this Task.",
    });
  });

  it("creates one Bug Task when two users press Create at once, refusing the second", async () => {
    const { asked } = await aProposingStage();
    const id = asked?.id ?? "";
    // Work takes its time, so the second Create arrives while the first is creating.
    creatingFor = 50;

    const answers = await Promise.allSettled(
      [0, 1].map(() => app.get(BugTaskDecisions).answer(id, answered(0), ANSWERED_BY_ANN_LEE)),
    );

    expect(created).toHaveLength(1);
    expect(answers.map(({ status }) => status).toSorted()).toEqual(["fulfilled", "rejected"]);
    expect(answers.find(({ status }) => status === "rejected")).toMatchObject({
      reason: new ThreadRefused(["This Decision is answered already."]),
    });
    expect((await repository.decision(id))?.answer).toMatchObject({ createdTaskId: "bug-task" });
  });

  it("creates nothing on Don't create it, and gives the Agent the comment", async () => {
    const { asked } = await aProposingStage();
    const id = asked?.id ?? "";

    await app
      .get(BugTaskDecisions)
      .answer(id, answered(1, { generalComment: "It's a Task already." }), ANSWERED_BY_ANN_LEE);

    expect(created).toEqual([]);
    const decision = await repository.decision(id);
    expect(decision && stageAnswerOf(decision)).toEqual({
      kind: "free-answer",
      text: `Didn't create the Bug Task "${PROPOSED.title}".\n\nGeneral comment: It's a Task already.`,
    });
  });

  it("keeps the Decision open with Work's refusal, creating nothing", async () => {
    const { asked } = await aProposingStage();
    const id = asked?.id ?? "";
    refusal = ["There is no Task cause-task."];

    await expect(
      app.get(BugTaskDecisions).answer(id, answered(0), ANSWERED_BY_ANN_LEE),
    ).rejects.toThrow(new ThreadRefused(["There is no Task cause-task."]));
    expect((await repository.decision(id))?.answer).toBeUndefined();
    // A Create can't be recorded but through the Bug Task's creation.
    await expect(
      app.get(DecisionService).answer(id, answered(0), ANSWERED_BY_ANN_LEE),
    ).rejects.toThrow("Create the Bug Task on its Decision's card.");
  });

  it("answers the Agent with the problems first, opening nothing, and that it opened the Decision", async () => {
    const { request, asked } = await aProposingStage({ ...PROPOSED, projectId: "nowhere" });
    expect(asked).toBeUndefined();
    const [thread] = await repository.listIn({ kind: "task", taskId: request.taskId });
    const sessionId = thread?.session?.id ?? "";
    const [tool] = app.get(OfficeToolRegistry).named([PROPOSE_BUG_TASK_TOOL]);

    expect(await tool?.run({ ...PROPOSED, projectId: "nowhere" }, { sessionId } as never)).toEqual({
      text: 'There is no Project "nowhere".',
      isError: true,
    });
    expect(await tool?.run(PROPOSED, { sessionId } as never)).toEqual({
      text: BUG_TASK_DECISION_OPENED,
      isError: false,
    });
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

describe("a Stage going on on a Stand-in Engine", () => {
  const WORK = FIRST_CLAUDE_CODE_ENGINE;
  const HOME = {
    ...FIRST_CLAUDE_CODE_ENGINE,
    id: "home",
    name: "Claude Code 2",
    claudeCodeP: true,
  };
  const MODEL = "claude-haiku-5-5";
  const RESETS_AT = new Date("2026-11-13T14:00:00.000Z");
  const WHY = { window: "five-hour", resetsAt: RESETS_AT } as const;

  /** The work engine's turn refused for its used-up 5-hour window, having taken `consumed`. */
  const aRefusedTurn = (consumed: string[] = ["brief"]): Step[] => [
    {
      step: "event",
      event: {
        kind: "turn-ended",
        outcome: "usage-window-used-up",
        consumedMessageIds: consumed,
        usage: USAGE,
        sessionCostUsd: 0,
        output: undefined,
        errors: ["You've hit your limit · resets 2pm (UTC)"],
        usedUpWindow: { window: "five-hour", resetsAt: RESETS_AT, resetGiven: true },
      },
    },
    { step: "read-context-usage", usage: { tokens: 30_000, window: 1_000_000 } },
  ];

  let home: ScriptedEngine;

  /** Starts the app with the work engine's `scripts`, and `homeScripts` on the stand-in. */
  async function startOnBoth(scripts: SessionScript[], homeScripts: SessionScript[]) {
    home = new ScriptedEngine(homeScripts);
    await startOn(new ScriptedEngine(scripts), NO_MCP_SERVERS, home);
    vi.spyOn(app.get(EngineModels), "engines").mockResolvedValue([WORK, HOME]);
  }

  /** Ada's Stage on the work engine, its first turn refused. */
  async function aRefusedStage(): Promise<{ stageThread: StageThread; ada: string }> {
    const ada = aPerson("Ada");
    const request = aStage({ roleKey: ada });
    cascade.set(ada, { engineId: WORK.id, model: MODEL }, request.projectId);
    const stageThread = await stageThreads.open(request);
    const turn = await stageThread.nextTurn();
    expect(turn.usedUpWindow).toEqual(WHY);
    return { stageThread, ada };
  }

  it("carries the session over, logs why and goes on there with the same model", async () => {
    await startOnBoth(
      [started(...aRefusedTurn())],
      [
        [
          { step: "resume" },
          { step: "send", message: { id: "go-on", text: "" }, priority: "later" },
          ...aTurn({ status: "done" }, "Going on."),
          { step: "end" },
        ],
      ],
    );
    const { stageThread } = await aRefusedStage();
    expect(stageThread.contextTokens()).toBe(30_000);
    const sessionId = engine.sessions[0]?.id;

    await stageThread.switchTo({ engineId: HOME.id, model: MODEL }, WHY);

    expect(stageThread).toMatchObject({
      engine: HOME.id,
      model: MODEL,
      standInFor: { engineId: WORK.id, engineName: WORK.name },
    });
    expect(engine.carried).toEqual([{ sessionId, from: WORK.id, to: HOME.id }]);
    expect(engine.sessions[0]?.received.at(-1)).toMatchObject({ step: "end" });
    expect((await threadOf(stageThread.threadId)).session).toMatchObject({
      id: sessionId,
      engineId: HOME.id,
      standInFor: { engineId: WORK.id, engineName: WORK.name },
    });
    expect(drafts(await repository.messages(stageThread.threadId)).at(-1)).toEqual({
      kind: "engine-switched",
      fromName: WORK.name,
      toName: HOME.name,
      window: "five-hour",
      resetsAt: "2026-11-13T14:00:00.000Z",
    });
    const turn = await stageThread.send("Go on where you were.", "Its window was used up.");
    expect(turn.output).toEqual({ status: "done" });
    const [onHome] = home.sessions;
    expect(onHome?.id).toBe(sessionId);
    expect(onHome?.options).toMatchObject({ engine: { id: HOME.id }, model: MODEL });
    expect(onHome?.received[1]).toMatchObject({
      step: "send",
      message: { text: "Go on where you were." },
    });
    await stageThread.end({ handoverNote: "Left: nothing.", closing: undefined });
    expect(onHome?.received.at(-1)).toMatchObject({ step: "end" });
  });

  it("sends the user's message the refused turn never took into the stand-in's next turn", async () => {
    const command = aCommand("npm-test");
    await startOnBoth(
      [started(command.call, aBargeIn("barge-in"), command.result, ...aRefusedTurn())],
      [
        [
          { step: "resume" },
          { step: "send", message: { id: "go-on", text: "" }, priority: "later" },
          aBargeIn("barge-in"),
          ...aTurn({ status: "done" }, "Renamed it on the list too.", ["go-on", "barge-in"]),
          { step: "end" },
        ],
      ],
    );
    const ada = aPerson("Ada");
    const request = aStage({ roleKey: ada });
    cascade.set(ada, { engineId: WORK.id, model: MODEL }, request.projectId);
    const stageThread = await stageThreads.open(request);
    await app.get(ThreadRunner).send(stageThread.threadId, "Rename it on the list too.", ANN_LEE);
    await stageThread.nextTurn();

    await stageThread.switchTo({ engineId: HOME.id, model: MODEL }, WHY);
    await stageThread.send("Go on where you were.", "Its window was used up.");

    expect(home.sessions[0]?.received[2]).toMatchObject({
      step: "send",
      priority: "next",
      message: { text: expect.stringContaining("Rename it on the list too.") },
    });
    expect(
      (await repository.messages(stageThread.threadId)).find(({ kind }) => kind === "user"),
    ).toMatchObject({ delivery: "delivered" });
    await stageThread.end({ handoverNote: undefined, closing: undefined });
  });

  it("stays on its engine when the session couldn't be carried over", async () => {
    await startOnBoth([started(...aRefusedTurn())], []);
    engine.failSessionCarries(new Error("The disk is full."));
    const { stageThread } = await aRefusedStage();

    const switching = stageThread.switchTo({ engineId: HOME.id, model: MODEL }, WHY);

    await expect(switching).rejects.toBeInstanceOf(SwitchFailed);
    await expect(switching).rejects.toHaveProperty("cause", new Error("The disk is full."));
    expect(stageThread.engine).toBe(WORK.id);
    const thread = await threadOf(stageThread.threadId);
    expect(thread.session?.engineId).toBe(WORK.id);
    expect(thread.session?.standInFor).toBeUndefined();
    const kinds = (await repository.messages(stageThread.threadId)).map(({ kind }) => kind);
    expect(kinds).not.toContain("engine-switched");
    expect(home.sessions).toEqual([]);
    await stageThread.end({ handoverNote: undefined, closing: undefined });
  });

  it("moves back to its engine when the stand-in didn't resume it, where the next Stage resumes it", async () => {
    await startOnBoth(
      [started(...aRefusedTurn()), resumed(...aTurn({ status: "done" }, "Going on."))],
      [],
    );
    const { stageThread, ada } = await aRefusedStage();

    await expect(
      stageThread.switchTo({ engineId: HOME.id, model: MODEL }, WHY),
    ).rejects.toBeInstanceOf(SwitchFailed);

    expect(stageThread.engine).toBe(WORK.id);
    const thread = await threadOf(stageThread.threadId);
    expect(thread.session?.engineId).toBe(WORK.id);
    expect(thread.session?.standInFor).toBeUndefined();
    expect(drafts(await repository.messages(stageThread.threadId)).at(-1)).toMatchObject({
      kind: "failure",
      reason: expect.stringMatching(
        /^The session didn't resume on Claude Code 2, so it stays on Claude Code: /,
      ),
    });
    await stageThread.end({ handoverNote: undefined, closing: undefined });
    const again = await stageThreads.open(
      aStage({ roleKey: ada, declared: "continue", previousThreadId: stageThread.threadId }),
    );
    expect(again).toMatchObject({ engine: WORK.id, move: { move: "resume" } });
    await again.nextTurn();
    expect(engine.sessions[1]?.id).toBe(engine.sessions[0]?.id);
    await again.end({ handoverNote: undefined, closing: undefined });
  });

  describe("a held Stage Thread moved to the stand-in", () => {
    const STAND_IN = { engineId: HOME.id, model: MODEL };

    it("carries its idle session over and records it there, opening no session on either engine", async () => {
      await startOnBoth([started(...aRefusedTurn())], []);
      const { stageThread } = await aRefusedStage();
      await stageThread.end({ handoverNote: undefined, closing: undefined });
      const sessionId = engine.sessions[0]?.id;

      await stageThreads.moveToStandIn(stageThread.threadId, STAND_IN, { from: WORK.id, ...WHY });

      expect(engine.carried).toEqual([{ sessionId, from: WORK.id, to: HOME.id }]);
      expect((await threadOf(stageThread.threadId)).session).toMatchObject({
        id: sessionId,
        engineId: HOME.id,
        standInFor: { engineId: WORK.id, engineName: WORK.name },
      });
      expect(drafts(await repository.messages(stageThread.threadId)).at(-1)).toEqual({
        kind: "engine-switched",
        fromName: WORK.name,
        toName: HOME.name,
        window: "five-hour",
        resetsAt: "2026-11-13T14:00:00.000Z",
      });
      expect(engine.sessions).toHaveLength(1);
      expect(home.sessions).toEqual([]);
    });

    it("is refused while the Thread is answering", async () => {
      await startOnBoth([started(...aRefusedTurn())], []);
      const { stageThread } = await aRefusedStage();

      const moving = stageThreads.moveToStandIn(stageThread.threadId, STAND_IN, {
        from: WORK.id,
        ...WHY,
      });

      await expect(moving).rejects.toBeInstanceOf(SwitchFailed);
      expect(engine.carried).toEqual([]);
      expect((await threadOf(stageThread.threadId)).session?.engineId).toBe(WORK.id);
      await stageThread.end({ handoverNote: undefined, closing: undefined });
    });

    it("is refused when its session isn't on the engine it moves from, leaving the Thread as it was", async () => {
      await startOnBoth([started(...aRefusedTurn())], []);
      const { stageThread } = await aRefusedStage();
      await stageThread.end({ handoverNote: undefined, closing: undefined });

      const moving = stageThreads.moveToStandIn(stageThread.threadId, STAND_IN, {
        from: HOME.id,
        ...WHY,
      });

      await expect(moving).rejects.toBeInstanceOf(SwitchFailed);
      expect(engine.carried).toEqual([]);
      const thread = await threadOf(stageThread.threadId);
      expect(thread.session?.engineId).toBe(WORK.id);
      expect(thread.session?.standInFor).toBeUndefined();
      const kinds = (await repository.messages(stageThread.threadId)).map(({ kind }) => kind);
      expect(kinds).not.toContain("engine-switched");
    });

    it("leaves the Thread on its engine when the session couldn't be carried over", async () => {
      await startOnBoth([started(...aRefusedTurn())], []);
      const { stageThread } = await aRefusedStage();
      await stageThread.end({ handoverNote: undefined, closing: undefined });
      engine.failSessionCarries(new Error("The disk is full."));

      const moving = stageThreads.moveToStandIn(stageThread.threadId, STAND_IN, {
        from: WORK.id,
        ...WHY,
      });

      await expect(moving).rejects.toBeInstanceOf(SwitchFailed);
      await expect(moving).rejects.toHaveProperty("cause", new Error("The disk is full."));
      const thread = await threadOf(stageThread.threadId);
      expect(thread.session?.engineId).toBe(WORK.id);
      expect(thread.session?.standInFor).toBeUndefined();
      const kinds = (await repository.messages(stageThread.threadId)).map(({ kind }) => kind);
      expect(kinds).not.toContain("engine-switched");
      expect(home.sessions).toEqual([]);
    });
  });
});
