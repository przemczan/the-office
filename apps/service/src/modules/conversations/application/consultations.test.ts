import { ANSWER_CONSULTATION_TOOL, CONSULT_TOOL } from "@the-office/contracts";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import {
  ANSWER_CONSULTATION_TOOL as SESSION_ANSWER_TOOL,
  consultationOfficeTools,
} from "../domain/session-instructions.js";
import { FireAlarmInThreads } from "./fire-alarm-in-threads.js";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { z } from "zod";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../platform/websocket/event-stream.module.js";
import {
  OfficeToolRegistry,
  ScriptedEngine,
  ScriptedEngineModule,
  type SessionScript,
} from "../../engine/index.js";
import { EngineCascade, RoleCards, type SessionRole } from "../../people/index.js";
import { EngineCascadeStandIn } from "../../people/index.fixtures.js";
import { SessionMcpServers } from "../../mcp-servers/index.js";
import { SessionSkills } from "../../skills/index.js";
import { DecisionOfficeTools } from "../adapters/office-tools/decision-office-tools.js";
import { PostgresThreadRepository } from "../adapters/postgres/postgres-thread-repository.js";
import type { Thread } from "../domain/thread.js";
import { startStageThread } from "../domain/thread-changes.js";
import { SESSION } from "../domain/decision.fixtures.js";
import { ConversationsSettings } from "../ports/conversations-settings.js";
import { ConversationsSettingsForTests } from "../ports/conversations-settings.fixtures.js";
import { OfficeInstructionsRepositoryForTests } from "../ports/office-instructions-repository.fixtures.js";
import { OfficeInstructionsRepository } from "../ports/office-instructions-repository.js";
import { OfficeInstructions } from "./office-instructions.js";
import { ProjectBases } from "../ports/project-bases.js";
import { noProjectBases } from "../ports/project-bases.fixtures.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { Briefs } from "./briefs.js";
import { Consultations } from "./consultations.js";
import { ContextPolicySettingsService } from "./context-policy-settings.js";
import { DecisionService } from "./decision-service.js";
import { InterruptedAnswers } from "./interrupted-answers.js";
import { aPlannerCard } from "./session-role.fixtures.js";
import { sessionMemoryProvider } from "./session-memory.fixtures.js";
import { SessionPlaces } from "./session-places.js";
import { CallChains } from "./call-chains.js";
import { StageDecisions } from "./stage-decisions.js";
import { StageThreads } from "./stage-threads.js";
import { InitiativeThreadSetups } from "./initiative-thread-setups.js";
import { TaskThreadSetups } from "./task-thread-setups.js";
import { ThreadContexts } from "./thread-contexts.js";
import { AllowChanges } from "./allow-changes.js";
import { ThreadRunner } from "./thread-runner.js";
import { MentionedRecords } from "./mentioned-records.js";
import { openPageRecordProviders } from "./open-page-records.fixtures.js";
import { WorkRecords } from "./work-records.js";
import { ThreadService } from "./thread-service.js";
import { FireAlarmLifts } from "./fire-alarm-lifts.js";
import { ApprovalHolds } from "./approval-holds.js";
import { FireAlarmLiftRepository } from "../ports/fire-alarm-lift-repository.js";
import { PostgresFireAlarmLiftRepository } from "../adapters/postgres/postgres-fire-alarm-lift-repository.js";
import { ChangesAllowedRepository } from "../ports/changes-allowed-repository.js";
import { PostgresChangesAllowedRepository } from "../adapters/postgres/postgres-changes-allowed-repository.js";
import { sessionMcpServersStandIn } from "./session-mcp-servers.fixtures.js";
import { ProjectOutputMasks } from "../ports/project-output-masks.js";
import { ProjectOutputMasksForTests } from "../ports/project-output-masks.fixtures.js";
import { SubAgentsAndProcesses } from "./sub-agents-and-processes.js";
import { SubAgentAndProcessRepository } from "../ports/sub-agent-and-process-repository.js";
import { PostgresSubAgentAndProcessRepository } from "../adapters/postgres/postgres-sub-agent-and-process-repository.js";
import { MCP_TOOL_DEFAULT_STAND_IN } from "../../people/index.fixtures.js";

// What consultations.test.ts and consultations.full.test.ts share.

const outputMasks = new ProjectOutputMasksForTests();

type Step = SessionScript[number];

const USAGE = { input: 3, output: 120, cacheRead: 0, cacheCreation: 26_000 };

const QUESTION = "Which database does the export use?";

const OPTIONS = ["SQLite", "Postgres"];

let app: INestApplication;

let engine: ScriptedEngine;

let officeData: string;

let askerKey: string;

let consultantKey: string;

let devopsKey: string;

let architectKey: string;

/** Whether the asker is a Consultant too, whom a callee could call back. */
let askerIsAConsultant: boolean;

let threads: ThreadService;

let decisions: DecisionService;

let consultations: Consultations;

function roleOf(roleKey: string): SessionRole {
  const consultant = { sharedMemory: false, chat: true, consultant: true, runEnvironment: false };
  const card = aPlannerCard(
    roleKey === consultantKey
      ? { name: "Casey", title: "CTO", capabilities: consultant }
      : roleKey === devopsKey
        ? { name: "Riley", title: "Devops", capabilities: consultant }
        : roleKey === architectKey
          ? { name: "Ari", title: "Architect", capabilities: consultant }
          : {
              name: "Dana",
              title: "Developer",
              capabilities: {
                sharedMemory: false,
                chat: true,
                consultant: false,
                runEnvironment: false,
              },
            },
  );
  return { roleKey, cardVersion: 1, card, mcpToolDefault: MCP_TOOL_DEFAULT_STAND_IN };
}

/** Boots the conversations on a scripted engine that replays `scripts`, one per session opened. */
async function startWith(...scripts: SessionScript[]): Promise<void> {
  engine = new ScriptedEngine(scripts);
  const sessionSkills: Pick<SessionSkills, "prepare" | "rebuild" | "forget"> = {
    prepare: ({ sessionId }) => Promise.resolve(noSkills(sessionId)),
    rebuild: (sessionId) => Promise.resolve(noSkills(sessionId)),
    forget: () => Promise.resolve(),
  };
  const roleCards: Pick<
    RoleCards,
    "find" | "forResumedSession" | "consultants" | "hiredKeys" | "roleTitle"
  > = {
    find: (key) =>
      Promise.resolve(
        [askerKey, consultantKey, devopsKey, architectKey].includes(key) ? roleOf(key) : undefined,
      ),
    forResumedSession: (key) => Promise.resolve(roleOf(key)),
    consultants: () =>
      Promise.resolve([
        { roleKey: consultantKey, name: "Casey", title: "CTO" },
        { roleKey: devopsKey, name: "Riley", title: "Devops" },
        { roleKey: architectKey, name: "Ari", title: "Architect" },
        ...(askerIsAConsultant ? [{ roleKey: askerKey, name: "Dana", title: "Developer" }] : []),
      ]),
    hiredKeys: () => Promise.resolve(new Set([askerKey, consultantKey, devopsKey, architectKey])),
    roleTitle: (key) => key,
  };
  const bases = noProjectBases(join(officeData, "bases"));
  ({ app } = await startTestApplication({
    database: true,
    imports: [
      EventsModule,
      EventStreamModule,
      TelemetryModule,
      OfficeDataModule.forRoot(officeData),
      ScriptedEngineModule.register(engine),
    ],
    providers: [
      { provide: ThreadRepository, useClass: PostgresThreadRepository },
      { provide: RoleCards, useValue: roleCards },
      { provide: EngineCascade, useValue: new EngineCascadeStandIn() },
      { provide: ProjectBases, useValue: bases },
      { provide: ProjectOutputMasks, useValue: outputMasks },
      { provide: SessionSkills, useValue: sessionSkills },
      { provide: SessionMcpServers, useValue: sessionMcpServersStandIn().service },
      { provide: ConversationsSettings, useValue: new ConversationsSettingsForTests() },
      { provide: OfficeInstructionsRepository, useClass: OfficeInstructionsRepositoryForTests },
      OfficeInstructions,
      ContextPolicySettingsService,
      ThreadService,
      Briefs,
      sessionMemoryProvider(),
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
      ...openPageRecordProviders(),
      WorkRecords,
      StageThreads,
      {
        provide: SubAgentAndProcessRepository,
        useClass: PostgresSubAgentAndProcessRepository,
      },
      SubAgentsAndProcesses,
      StageDecisions,
      InterruptedAnswers,
      DecisionService,
      Consultations,
      FireAlarmInThreads,
      DecisionOfficeTools,
    ],
  }));
  // As the Work, People and Skills modules register the tools a Consultation reads and drafts with.
  for (const name of consultationOfficeTools(consultantKey, true).filter(
    (tool) => tool !== ANSWER_CONSULTATION_TOOL && tool !== CONSULT_TOOL,
  )) {
    app.get(OfficeToolRegistry).register({
      name,
      description: `Reads ${name}.`,
      input: z.object({}),
      run: () => Promise.resolve({ text: "Nothing.", isError: false }),
    });
  }
  app.get(TaskThreadSetups).provide({
    planner: "planner",
    readyForPersonsThread: () => Promise.resolve(undefined),
    planningThreadElsewhere: () => Promise.resolve(undefined),
    setUp: ({ taskId }) =>
      Promise.resolve({
        folder: join(officeData, "worktrees", taskId),
        environment: {},
        useProjectSkills: false,
        projectSkillsOff: [],
        projectId: "admin-panel",
        instructions: "On this Task you build.",
        officeTools: ["read_task", CONSULT_TOOL],
        brief: `You work on the Task ${taskId}.`,
        asking: false,
        sessionRefusal: undefined,
      }),
  });
  threads = app.get(ThreadService);
  decisions = app.get(DecisionService);
  consultations = app.get(Consultations);
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

function aTurn(consumed: string, text: string): Step[] {
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
    { step: "read-context-usage", usage: { tokens: 32_000, window: 1_000_000 } },
  ];
}

function started(...steps: Step[]): SessionScript {
  return [{ step: "start", brief: { id: "brief", text: "" } }, ...steps];
}

function usesTool(callId: string, tool: string, input: Record<string, unknown>): Step[] {
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

/** The developer consults `person` with a question, then ends their turn. */
function consults(person: string): Step[] {
  return [
    ...usesTool("c-1", CONSULT_TOOL, {
      person,
      question: QUESTION,
      context: "The export reads every Project.",
      options: OPTIONS,
      recommended: 2,
      why: "It is what the Projects use.",
    }),
    ...aTurn("brief", "I asked."),
  ];
}

async function consultationsOn(asker: Thread): Promise<readonly Thread[]> {
  const onTask = await threads.listOnTask((asker.home as { taskId: string }).taskId);
  return onTask.filter(({ consultation }) => consultation);
}

const ASKER_TAKES_THE_ANSWER: Step[] = [
  { step: "send", message: { id: "answer", text: "" }, priority: "later" },
  ...aTurn("answer", "Then Postgres."),
];

async function developerOnATask(): Promise<Thread> {
  const opened = await threads.openOnTask({
    taskId: randomUUID(),
    roleKey: askerKey,
    title: "Build the export",
  });
  return app.get(ThreadRunner).send(opened.id, "Build the export.");
}

/** The Consultation on the Task, once it has started. */
async function consultationOn(asker: Thread): Promise<Thread> {
  return vi.waitFor(
    async () => {
      const found = (
        await threads.listOnTask(asker.home.kind === "task" ? asker.home.taskId : "")
      ).find(({ consultation }) => consultation !== undefined);
      if (!found) throw new Error("No Consultation yet.");
      return found;
    },
    { timeout: 5_000, interval: 20 },
  );
}

async function settled(threadId: string): Promise<Thread> {
  return vi.waitFor(
    async () => {
      const thread = await threads.read(threadId);
      if (thread.state !== "waiting") throw new Error("Still answering.");
      return thread;
    },
    { timeout: 5_000, interval: 20 },
  );
}

/** The hooks every test of both files runs. */
function setUpEachTest(): void {
  beforeEach(async () => {
    officeData = await mkdtemp(join(tmpdir(), "office-consultations-"));
    askerKey = `asker-${randomUUID()}`;
    consultantKey = `consultant-${randomUUID()}`;
    devopsKey = `devops-${randomUUID()}`;
    architectKey = `architect-${randomUUID()}`;
    askerIsAConsultant = false;
  });

  afterEach(async () => {
    await app.close();
    await rm(officeData, { recursive: true, force: true });
  });
}

setUpEachTest();

describe("a consult during the fire alarm", () => {
  const ALARM_ON = { on: true, since: new Date("2026-10-29T09:00:00.000Z") } as const;

  it("opens no Consultation while it is on: the Decision still waits on its Consultant", async () => {
    await startWith(started(...consults("CTO")));
    let consulted = false;
    const open = decisions.open.bind(decisions);
    vi.spyOn(decisions, "open").mockImplementation(async (...given) => {
      const opened = await open(...given);
      consulted = true;
      return opened;
    });
    // Sounded once the Agent's consult is in, before its turn ends: the alarm holds the consult itself.
    app
      .get(FireAlarmInThreads)
      .readFrom(() => Promise.resolve(consulted ? ALARM_ON : { on: false }));
    const asker = await developerOnATask();

    await settled(asker.id);
    await consultations.openFor(await threads.read(asker.id));

    expect(await consultationsOn(asker)).toEqual([]);
    expect((await threads.read(asker.id)).openDecisions[0]).toMatchObject({ putTo: consultantKey });
  });
});

describe("a consult of a hired Consultant", () => {
  it("opens a Consultation labelled with both, which the Consultant answers for the Agent", async () => {
    await startWith(
      started(...consults("CTO"), ...ASKER_TAKES_THE_ANSWER),
      started(
        ...usesTool("c-2", ANSWER_CONSULTATION_TOOL, { option: 2 }),
        ...aTurn("brief", "Done."),
      ),
    );
    const asker = await developerOnATask();

    const consultation = await consultationOn(asker);
    await settled(consultation.id);
    const answeredAsker = await vi.waitFor(
      async () => {
        const [decision] = await decisions.listInThread(asker.id);
        if (!decision?.answer) throw new Error("Not answered yet.");
        return decision;
      },
      { timeout: 5_000, interval: 20 },
    );
    await settled(asker.id);

    expect(SESSION_ANSWER_TOOL).toBe(ANSWER_CONSULTATION_TOOL);
    expect(consultation).toMatchObject({
      roleKey: consultantKey,
      title: "Consultation · Dana and Casey",
      consultation: { askerThreadId: asker.id, askerRoleKey: askerKey },
    });
    expect(answeredAsker).toMatchObject({
      putTo: consultantKey,
      answer: { kind: "option", option: 1, answeredBy: consultantKey },
    });
    const [askerSession, consultantSession] = engine.sessions;
    const opening = consultantSession?.received[0];
    expect(opening?.step === "start" && opening.brief.text).toContain(QUESTION);
    expect(consultantSession?.options.officeTools.map(({ name }) => name)).toEqual([
      ...consultationOfficeTools(consultantKey, true),
    ]);
    const consultationLog = await threads.messages(consultation.id);
    expect(consultationLog).toContainEqual(
      expect.objectContaining({
        kind: "consultation-line",
        text: "Your answer to Dana: Postgres",
      }),
    );
    const answer = askerSession?.received.find((step) => step.step === "send");
    expect(answer?.step === "send" && answer.message.text).toBe(
      `Casey answered your Decision "${QUESTION}" with the option "Postgres".`,
    );
  });
});

/** The asker calls `person` with a request, then ends their turn. */
function requests(person: string, callId = "c-1"): Step[] {
  return [
    ...usesTool(callId, CONSULT_TOOL, {
      person,
      kind: "request",
      question: "Set up the Project's commands.",
      context: "The user asked me to have it set up.",
      why: "I can't draft Project commands.",
    }),
    ...aTurn("brief", "I asked them."),
  ];
}

async function aChatWith(roleKey: string, said: string): Promise<Thread> {
  const opened = await threads.startInChat(roleKey);
  return app.get(ThreadRunner).send(opened.id, said);
}

/** The Consultations in the person's chat, once one has started. */
async function consultationInChatOf(roleKey: string): Promise<Thread> {
  return vi.waitFor(
    async () => {
      const found = (await threads.listInChat(roleKey)).find(({ consultation }) => consultation);
      if (!found) throw new Error("No Consultation yet.");
      return found;
    },
    { timeout: 5_000, interval: 20 },
  );
}

/** The Thread once its person answered in it and waits again. */
async function answeredOnce(threadId: string): Promise<Thread> {
  return vi.waitFor(
    async () => {
      const thread = await threads.read(threadId);
      if (!thread.session || thread.state !== "waiting") throw new Error("Not answered yet.");
      return thread;
    },
    { timeout: 5_000, interval: 20 },
  );
}

async function answeredIn(threadId: string) {
  return vi.waitFor(
    async () => {
      const [decision] = await decisions.listInThread(threadId);
      if (!decision?.answer) throw new Error("Not answered yet.");
      return decision;
    },
    { timeout: 5_000, interval: 20 },
  );
}

/** What the session read back from the tool call `callId`. */
function toolResultOf(session: (typeof engine.sessions)[number] | undefined, callId: string) {
  return session?.reportedEvents.find(
    (event) => event.kind === "tool-result" && event.callId === callId,
  );
}

describe("a call from a chat", () => {
  it("opens the callee's Consultation in their own chat, and their answer in words reaches the caller", async () => {
    await startWith(
      started(...requests("Devops"), ...ASKER_TAKES_THE_ANSWER),
      started(
        ...usesTool("c-2", ANSWER_CONSULTATION_TOOL, {
          answer: "I drafted a Proposal of the Project's commands.",
        }),
        ...aTurn("brief", "Done."),
      ),
    );
    const caller = await aChatWith(askerKey, "Ask Devops to set that up.");

    const consultation = await consultationInChatOf(devopsKey);
    await settled(consultation.id);
    const answered = await answeredIn(caller.id);
    await settled(caller.id);

    expect(consultation).toMatchObject({
      home: { kind: "chat", roleKey: devopsKey },
      title: "Consultation · Dana and Riley",
      consultation: { askerThreadId: caller.id, askerRoleKey: askerKey },
    });
    expect(answered).toMatchObject({
      kind: "request",
      taskId: undefined,
      putTo: devopsKey,
      answer: {
        kind: "free-answer",
        text: "I drafted a Proposal of the Project's commands.",
        answeredBy: devopsKey,
      },
    });
    const [callerSession, calleeSession] = engine.sessions;
    const opening = calleeSession?.received[0];
    expect(opening?.step === "start" && opening.brief.text).toContain(
      "Dana asks you to: Set up the Project's commands.",
    );
    const answer = callerSession?.received.find((step) => step.step === "send");
    expect(answer?.step === "send" && answer.message.text).toBe(
      `Riley answered your request "Set up the Project's commands." in their own words:\n\nI drafted a Proposal of the Project's commands.`,
    );
    const lines = (await threads.messages(consultation.id))
      .filter((message) => message.kind === "consultation-line")
      .map((line) => line.kind === "consultation-line" && line.text);
    expect(lines).toEqual([
      "Dana asks you to: Set up the Project's commands.",
      "Your answer to Dana: I drafted a Proposal of the Project's commands.",
    ]);
  });

  it("gives the callee their own tools, never the caller's, and no write access", async () => {
    await startWith(started(...requests("Devops")), started(...aTurn("brief", "Looking.")));
    await aChatWith(askerKey, "Ask Devops to set that up.");

    const consultation = await consultationInChatOf(devopsKey);
    await vi.waitFor(() => {
      if (engine.sessions.length < 2) throw new Error("The callee hasn't started yet.");
    });
    await settled(consultation.id);

    const [, calleeSession] = engine.sessions;
    expect(calleeSession?.options.officeTools.map(({ name }) => name)).toEqual([
      ...consultationOfficeTools(devopsKey, true),
    ]);
    expect(calleeSession?.options.profile).toMatchObject({
      edit: false,
      run: { kind: "read-only-git" },
    });
    expect(calleeSession?.options.workstation).toBe(false);
  });

  it("refuses a call naming nobody who can be called: the caller asks the user in their answer", async () => {
    await startWith(started(...requests("Janitor"), ...aTurn("brief", "I'll ask the user.")));
    const caller = await aChatWith(askerKey, "Ask the janitor.");

    await settled(caller.id);

    expect(toolResultOf(engine.sessions[0], "c-1")).toMatchObject({
      isError: true,
      text: "Nobody who can be called fills that Role: ask the user in your answer instead.",
    });
    expect(await decisions.listInThread(caller.id)).toEqual([]);
  });

  it("goes back to the caller as a line when the callee passes it on to the user", async () => {
    await startWith(
      started(
        ...usesTool("c-1", CONSULT_TOOL, {
          person: "Devops",
          kind: "approval",
          question: "Install ffmpeg on the machine.",
          context: "Video exports need it.",
          why: "No other way.",
        }),
        ...aTurn("brief", "I asked."),
        ...ASKER_TAKES_THE_ANSWER,
      ),
      started(
        ...usesTool("c-2", ANSWER_CONSULTATION_TOOL, {
          passOn: { why: "It changes the machine." },
        }),
        ...aTurn("brief", "Passed on."),
      ),
    );
    const caller = await aChatWith(askerKey, "Ask Devops whether ffmpeg may be installed.");

    const answered = await answeredIn(caller.id);
    await settled(caller.id);

    expect(answered.answer).toMatchObject({ kind: "free-answer", byTheOffice: true });
    expect(await decisions.listOpen()).not.toContainEqual(
      expect.objectContaining({ id: answered.id }),
    );
    const answer = engine.sessions[0]?.received.find((step) => step.step === "send");
    expect(answer?.step === "send" && answer.message.text).toContain(
      "Riley passed it on to the user: It changes the machine. So it is the user's now: ask them in your reply.",
    );
  });
});

describe("a call from a Consultation", () => {
  it("nests: the callee calls a third person, whose answer comes back down the chain", async () => {
    await startWith(
      started(...requests("Devops"), ...ASKER_TAKES_THE_ANSWER),
      started(
        ...usesTool("c-2", CONSULT_TOOL, {
          person: "CTO",
          question: QUESTION,
          context: "Before I draft the commands.",
          options: OPTIONS,
          recommended: 2,
          why: "It is what the Projects use.",
        }),
        ...aTurn("brief", "I asked the CTO."),
        { step: "send", message: { id: "cto-answer", text: "" }, priority: "later" },
        ...usesTool("c-4", ANSWER_CONSULTATION_TOOL, { answer: "Drafted, for Postgres." }),
        ...aTurn("cto-answer", "Done."),
      ),
      started(
        ...usesTool("c-3", ANSWER_CONSULTATION_TOOL, { option: 2 }),
        ...aTurn("brief", "Postgres."),
      ),
    );
    const caller = await aChatWith(askerKey, "Ask Devops to set that up.");

    const answered = await answeredIn(caller.id);
    await settled(caller.id);

    const devopsConsultation = await consultationInChatOf(devopsKey);
    const ctoConsultation = await consultationInChatOf(consultantKey);
    expect(ctoConsultation.consultation).toMatchObject({
      askerThreadId: devopsConsultation.id,
      askerRoleKey: devopsKey,
    });
    expect(answered.answer).toMatchObject({
      text: "Drafted, for Postgres.",
      answeredBy: devopsKey,
    });
    const [, devopsSession, ctoSession] = engine.sessions;
    expect(devopsSession?.options.officeTools.map(({ name }) => name)).toContain(CONSULT_TOOL);
    // The chain has asked two people: the CTO can call nobody else.
    expect(ctoSession?.options.officeTools.map(({ name }) => name)).not.toContain(CONSULT_TOOL);
  });

  it("refuses calling someone already in the chain, naming them", async () => {
    // The asker is a Consultant too, so the callee could otherwise call them back.
    askerIsAConsultant = true;
    await startWith(
      started(...requests("Devops")),
      started(
        ...usesTool("c-2", CONSULT_TOOL, {
          person: "Developer",
          kind: "request",
          question: "Tell me which Project.",
          context: "Before I draft.",
          why: "I need the Project.",
        }),
        ...aTurn("brief", "I'll answer from what I have."),
      ),
    );
    await aChatWith(askerKey, "Ask Devops to set that up.");

    await answeredOnce((await consultationInChatOf(devopsKey)).id);

    expect(toolResultOf(engine.sessions[1], "c-2")).toMatchObject({
      isError: true,
      text: "Dana is already in this chain of calls: answer from what you have, or pass it on to the user.",
    });
  });

  it("refuses a third person down one chain, even without the tool", async () => {
    await startWith(
      started(...requests("Devops")),
      started(...requests("CTO", "c-2")),
      started(...aTurn("brief", "Looking.")),
    );
    await aChatWith(askerKey, "Ask Devops to set that up.");

    const ctoConsultation = await answeredOnce((await consultationInChatOf(consultantKey)).id);
    await expect(
      consultations.put(ctoConsultation.session?.id ?? "", {
        kind: "request",
        person: "Architect",
        request: "Review it.",
        context: "",
        why: "A third opinion.",
      }),
    ).rejects.toThrow(
      "This chain of calls has asked 2 people already, the most it may: answer from what you have, or pass it on to the user.",
    );
  });
});

describe("a call from a Stage that can write", () => {
  it("gives the callee no write access of the Stage's: their session is built from them alone", async () => {
    await startWith(started(...aTurn("brief", "Looking.")));
    const { thread } = startStageThread(
      randomUUID(),
      { taskId: randomUUID(), roleKey: askerKey, title: "Implement · Dana" },
      new Date(),
    );
    const stageSession = { ...SESSION, id: randomUUID(), roleKey: askerKey };
    const stage = { ...thread, state: "answering" as const, session: stageSession };
    await app.get(ThreadRepository).add(stage);

    await consultations.put(stageSession.id, {
      kind: "request",
      person: "Devops",
      request: "Set up the Project's commands.",
      context: "The Stage needs them.",
      why: "Only Devops drafts them.",
    });
    await consultations.openFor(await threads.read(stage.id));
    const consultation = await consultationOn(stage);
    await settled(consultation.id);

    const [calleeSession] = engine.sessions;
    expect(consultation.home).toEqual(stage.home);
    expect(calleeSession?.options.profile).toMatchObject({
      edit: false,
      run: { kind: "read-only-git" },
    });
    expect(calleeSession?.options.workstation).toBe(false);
    expect(calleeSession?.options.officeTools.map(({ name }) => name)).not.toContain("change_role");
  });
});
