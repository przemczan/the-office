import { ANSWER_CONSULTATION_TOOL, CONSULT_TOOL } from "@the-office/contracts";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import {
  ANSWER_CONSULTATION_TOOL as SESSION_ANSWER_TOOL,
  CONSULTATION_OFFICE_TOOLS,
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
import { ConversationsSettings } from "../ports/conversations-settings.js";
import { ConversationsSettingsForTests } from "../ports/conversations-settings.fixtures.js";
import { OfficeInstructionsRepositoryForTests } from "../ports/office-instructions-repository.fixtures.js";
import { OfficeInstructionsRepository } from "../ports/office-instructions-repository.js";
import { OfficeInstructions } from "./office-instructions.js";
import { ProjectBases } from "../ports/project-bases.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { Briefs } from "./briefs.js";
import { Consultations } from "./consultations.js";
import { ContextPolicySettingsService } from "./context-policy-settings.js";
import { DecisionService } from "./decision-service.js";
import { InterruptedAnswers } from "./interrupted-answers.js";
import { aPlannerCard } from "./session-role.fixtures.js";
import { sessionMemoryProvider } from "./session-memory.fixtures.js";
import { SessionPlaces } from "./session-places.js";
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
  return { roleKey, cardVersion: 1, card };
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
      ]),
    hiredKeys: () => Promise.resolve(new Set([askerKey, consultantKey, devopsKey, architectKey])),
    roleTitle: (key) => key,
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
      StageDecisions,
      InterruptedAnswers,
      DecisionService,
      Consultations,
      FireAlarmInThreads,
      DecisionOfficeTools,
    ],
  }));
  // As the Work and People modules register the tools the Consultation reads records with.
  for (const name of CONSULTATION_OFFICE_TOOLS.filter(
    (tool) => tool !== ANSWER_CONSULTATION_TOOL,
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
    { step: "event", event: { kind: "tool-result", callId, text: "", isError: false } },
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
    expect((await threads.read(asker.id)).openDecision).toMatchObject({ putTo: consultantKey });
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
      ...CONSULTATION_OFFICE_TOOLS,
    ]);
    const answer = askerSession?.received.find((step) => step.step === "send");
    expect(answer?.step === "send" && answer.message.text).toBe(
      `Casey answered your Decision "${QUESTION}" with the option "Postgres".`,
    );
  });
});
