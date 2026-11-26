import { ANSWER_CONSULTATION_TOOL, CONSULT_TOOL } from "@the-office/contracts";
import { ContractMessageImageRules } from "../adapters/http/contract-message-image-rules.js";
import { MessageImageRules } from "../ports/message-image-rules.js";
import { MessageImages } from "./message-images.js";
import { ThreadImages } from "./thread-images.js";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import {
  ANSWER_CONSULTATION_TOOL as SESSION_ANSWER_TOOL,
  consultationOfficeTools,
} from "../domain/session-instructions.js";
import { FireAlarmInThreads } from "./fire-alarm-in-threads.js";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { z } from "zod";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventsModule } from "../../../platform/events/events.module.js";
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
import { EngineSettingsForTests } from "../../engine/index.fixtures.js";
import { EngineCascade, RoleCards, type SessionRole } from "../../people/index.js";
import { BusyWorkModule } from "../../office-updates/index.js";
import { EngineCascadeStandIn } from "../../people/index.fixtures.js";
import { SessionMcpServers } from "../../mcp-servers/index.js";
import { SessionSkills } from "../../skills/index.js";
import { skillCommandsProvider } from "./skill-commands.fixtures.js";
import { DecisionOfficeTools } from "../adapters/office-tools/decision-office-tools.js";
import { PostgresThreadRepository } from "../adapters/postgres/postgres-thread-repository.js";
import type { Thread } from "../domain/thread.js";
import { startStageThread } from "../domain/thread-changes.js";
import { oneOptionAnswer, oneWordsAnswer } from "../domain/decision.js";
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
import { DutiesStandIn, dutiesProvider } from "./duties.fixtures.js";
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
import { SessionStops } from "./session-stops.js";
import { SubAgentAndProcessRepository } from "../ports/sub-agent-and-process-repository.js";
import { PostgresSubAgentAndProcessRepository } from "../adapters/postgres/postgres-sub-agent-and-process-repository.js";
import { MCP_TOOL_DEFAULT_STAND_IN } from "../../people/index.fixtures.js";
import { ANN_LEE } from "../domain/user.fixtures.js";
import { ConversationsPromptTemplatesForTests } from "../adapters/prompt-templates/conversations-prompt-templates.fixtures.js";

// What consultations.test.ts and consultations.full.test.ts share.

const outputMasks = new ProjectOutputMasksForTests();

/** Who holds each duty: their default Roles, so none of the Roles here, under keys of their own. */
const duties = new DutiesStandIn();

type Step = SessionScript[number];

const USAGE = { input: 3, output: 120, cacheRead: 0, cacheCreation: 26_000 };

const QUESTION = "Which database does the export use?";

const OPTIONS = ["SQLite", "Postgres"];

let app: INestApplication;

let engine: ScriptedEngine;

/**
 * A second Claude Code engine, listed as the Stand-in Engine, when a test boots with one through
 * `startWithStandIn` (spec 5.4).
 */
let standIn: ScriptedEngine | undefined;

const HOME = { ...FIRST_CLAUDE_CODE_ENGINE, id: "home", name: "Claude Code 2", claudeCodeP: true };

let officeData: string;

let askerKey: string;

let consultantKey: string;

let devopsKey: string;

let architectKey: string;

/** Whether the asker is a Consultant too, whom a callee could call back. */
let askerIsAConsultant: boolean;

/** Whether the Tasks have their worktree yet; a Task planned in its Initiative's Thread has none. */
let worktreeMade: boolean;

/**
 * Whose sessions, by Role key, fail reading their Project skills in a folder that isn't there, as
 * running git there did ("spawn git ENOENT").
 */
let missingFolderFailsFor: string | undefined;

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
    prepare: async ({ sessionId, roleKey, project }) => {
      if (roleKey === missingFolderFailsFor && project && !(await isFolder(project.folder))) {
        throw new Error("spawn git ENOENT");
      }
      return noSkills(sessionId);
    },
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
      ConversationsPromptTemplatesForTests,
      EventsModule,
      ScheduleModule,
      BusyWorkModule,
      EventStreamModule,
      TelemetryModule,
      OfficeDataModule.forRoot(officeData),
      ScriptedEngineModule.register(
        standIn === undefined
          ? engine
          : {
              "agent-sdk": engine,
              "claude-code-p": standIn,
              "openai-compatible-api": new ScriptedEngine([]),
              codex: new ScriptedEngine([]),
              "copilot-cli": new ScriptedEngine([]),
              "gemini-cli": new ScriptedEngine([]),
            },
      ),
    ],
    providers: [
      { provide: ThreadRepository, useClass: PostgresThreadRepository },
      { provide: RoleCards, useValue: roleCards },
      { provide: EngineCascade, useValue: cascadeWith(standIn) },
      { provide: ProjectBases, useValue: bases },
      { provide: ProjectOutputMasks, useValue: outputMasks },
      { provide: SessionSkills, useValue: sessionSkills },
      skillCommandsProvider(),
      { provide: SessionMcpServers, useValue: sessionMcpServersStandIn().service },
      { provide: ConversationsSettings, useValue: new ConversationsSettingsForTests() },
      { provide: OfficeInstructionsRepository, useClass: OfficeInstructionsRepositoryForTests },
      OfficeInstructions,
      ContextPolicySettingsService,
      ThreadService,
      Briefs,
      MessageImages,
      ThreadImages,
      { provide: MessageImageRules, useClass: ContractMessageImageRules },
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
      ...openPageRecordProviders(),
      WorkRecords,
      StageThreads,
      {
        provide: SubAgentAndProcessRepository,
        useClass: PostgresSubAgentAndProcessRepository,
      },
      SubAgentsAndProcesses,
      SessionStops,
      StageDecisions,
      InterruptedAnswers,
      DecisionService,
      Consultations,
      FireAlarmInThreads,
      DecisionOfficeTools,
    ],
    overrides:
      standIn === undefined
        ? []
        : [
            {
              provide: EngineModels,
              useValue: new EngineModels(
                new EngineSettingsForTests({
                  engines: [FIRST_CLAUDE_CODE_ENGINE, HOME],
                  standInEngines: [HOME.id],
                }),
              ),
            },
          ],
  }));
  // As the Work, People and Skills modules register the tools a Consultation reads and drafts with.
  for (const name of consultationOfficeTools(
    { held: await duties.heldBy(consultantKey), caretaker: false },
    {
      canCall: true,
      onTask: false,
      runEnvironment: false,
    },
  ).filter((tool) => tool !== ANSWER_CONSULTATION_TOOL && tool !== CONSULT_TOOL)) {
    app.get(OfficeToolRegistry).register({
      name,
      description: `Reads ${name}.`,
      input: z.object({}),
      run: () => Promise.resolve({ text: "Nothing.", isError: false }),
    });
  }
  app.get(TaskThreadSetups).provide({
    planner: () => Promise.resolve("planner"),
    readyForPersonsThread: () => Promise.resolve(undefined),
    planningThreadElsewhere: () => Promise.resolve(undefined),
    setUp: ({ taskId }) =>
      Promise.resolve({
        folder: worktreeMade ? join(officeData, "worktrees", taskId) : undefined,
        environment: {},
        useProjectSkills: false,
        projectSkillsOff: [],
        projectId: "admin-panel",
        initiativeId: undefined,
        projectName: "Admin panel",
        pipelineName: "",
        instructions: "On this Task you build.",
        officeTools: ["read_task", CONSULT_TOOL],
        brief: `You work on the Task ${taskId}.`,
        asking: false,
        sessionRefusal: undefined,
      }),
  });
  // As the Work module sets up its Initiatives' Threads, each with consult (spec §2.4).
  app.get(InitiativeThreadSetups).provide({
    setUp: ({ initiativeId }) =>
      Promise.resolve({
        instructions: "On this Initiative you shape.",
        officeTools: [CONSULT_TOOL],
        record: `You are shaping the Initiative ${initiativeId}.`,
        sessionRefusal: undefined,
        branchReads: undefined,
      }),
  });
  // As the Work module gives its records: every Task is any Initiative's here.
  app.get(WorkRecords).provide({
    taskSubjects: () => Promise.resolve(new Map()),
    taskRecord: () => Promise.resolve(undefined),
    taskTitle: () => Promise.resolve("Build the export"),
    taskAttachmentIds: () => Promise.resolve([]),
    initiativeTaskAttachmentIds: () => Promise.resolve([]),
    isInitiativePlanningThread: () => Promise.resolve(true),
    initiativeAttachmentIds: () => Promise.resolve([]),
    initiativeRecord: () => Promise.resolve(undefined),
    initiativeName: () => Promise.resolve(undefined),
    projectWork: () => Promise.resolve({ taskIds: [], initiativeIds: [] }),
    ideaRecord: () => Promise.resolve(undefined),
  });
  threads = app.get(ThreadService);
  decisions = app.get(DecisionService);
  consultations = app.get(Consultations);
}

/** The engine cascade, giving `HOME` as the Stand-in Engine list that applies when it stands in. */
function cascadeWith(home: ScriptedEngine | undefined): EngineCascadeStandIn {
  const cascade = new EngineCascadeStandIn();
  if (home !== undefined) cascade.standIns = { from: "office", engineIds: [HOME.id] };
  return cascade;
}

/** Boots as `startWith` does, with `HOME` replaying `homeScripts` as the Stand-in Engine. */
async function startWithStandIn(
  scripts: readonly SessionScript[],
  homeScripts: readonly SessionScript[],
): Promise<void> {
  standIn = new ScriptedEngine(homeScripts);
  await startWith(...scripts);
}

async function isFolder(path: string): Promise<boolean> {
  return stat(path).then(
    (found) => found.isDirectory(),
    () => false,
  );
}

function noSkills(sessionId: string): Awaited<ReturnType<SessionSkills["prepare"]>> {
  return {
    folder: join(officeData, "sessions", sessionId, "skills"),
    names: [],
    expected: [],
    userOnly: [],
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
      context: "The export reads every Project.",
      questions: [
        {
          question: QUESTION,
          options: OPTIONS,
          recommended: 2,
          why: "It is what the Projects use.",
        },
      ],
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
  return app.get(ThreadRunner).send(opened.id, "Build the export.", ANN_LEE);
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
    worktreeMade = true;
    missingFolderFailsFor = undefined;
    standIn = undefined;
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
        ...usesTool("c-2", ANSWER_CONSULTATION_TOOL, { answers: [{ option: 2 }] }),
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
      answer: { ...oneOptionAnswer(1), answeredBy: consultantKey },
    });
    const [askerSession, consultantSession] = engine.sessions;
    const opening = consultantSession?.received[0];
    expect(opening?.step === "start" && opening.brief.text).toContain(QUESTION);
    expect(consultantSession?.options.officeTools.map(({ name }) => name)).toEqual([
      ...consultationOfficeTools(
        { held: await duties.heldBy(consultantKey), caretaker: false },
        {
          canCall: true,
          onTask: false,
          runEnvironment: false,
        },
      ),
    ]);
    const consultationLog = await threads.messages(consultation.id);
    expect(consultationLog).toContainEqual(
      expect.objectContaining({
        kind: "consultation-line",
        text: `Your answer to Dana:\n\n1. ${QUESTION}\n   Answer: Postgres`,
      }),
    );
    const answer = askerSession?.received.find((step) => step.step === "send");
    expect(answer?.step === "send" && answer.message.text).toBe(
      `Casey answered your Decision:\n\n1. ${QUESTION}\n   Answer: Postgres`,
    );
  });
  it("asks a form of two questions, which the Consultant answers question by question", async () => {
    await startWith(
      started(
        ...usesTool("c-1", CONSULT_TOOL, {
          person: "CTO",
          context: "The export reads every Project.",
          questions: [
            {
              question: QUESTION,
              options: OPTIONS,
              recommended: 2,
              why: "It is what the Projects use.",
            },
            { question: "Which years should it cover?" },
          ],
        }),
        ...aTurn("brief", "I asked."),
        ...ASKER_TAKES_THE_ANSWER,
      ),
      started(
        ...usesTool("c-2", ANSWER_CONSULTATION_TOOL, { answers: [{ option: 2 }] }),
        ...usesTool("c-3", ANSWER_CONSULTATION_TOOL, {
          answers: [{ option: 2, comment: "It runs already." }, { answer: "This year." }],
          generalComment: "Ask me about the format later.",
        }),
        ...aTurn("brief", "Done."),
      ),
    );
    const asker = await developerOnATask();

    const consultation = await consultationOn(asker);
    await settled(consultation.id);
    const answered = await answeredIn(asker.id);
    await settled(asker.id);

    const opening = engine.sessions[1]?.received[0];
    const brief = opening?.step === "start" ? opening.brief.text : "";
    expect(brief).toContain(QUESTION);
    expect(brief).toContain("Which years should it cover?");
    const [refused] =
      engine.sessions[1]?.reportedEvents.filter((event) => event.kind === "tool-result") ?? [];
    expect(refused).toMatchObject({
      isError: true,
      text: "Answer every question: this Decision asks 2.",
    });
    expect(answered.answer).toMatchObject({
      kind: "submitted",
      answers: [
        { kind: "option", option: 1, comment: "It runs already." },
        { kind: "words", text: "This year." },
      ],
      generalComment: "Ask me about the format later.",
      answeredBy: consultantKey,
    });
    const words = [
      `1. ${QUESTION}`,
      "   Answer: Postgres",
      "   Comment: It runs already.",
      "2. Which years should it cover?",
      "   Answer, in their own words: This year.",
      "",
      "General comment: Ask me about the format later.",
    ].join("\n");
    const answer = engine.sessions[0]?.received.find((step) => step.step === "send");
    expect(answer?.step === "send" && answer.message.text).toBe(
      `Casey answered your Decision:\n\n${words}`,
    );
    expect(await threads.messages(consultation.id)).toContainEqual(
      expect.objectContaining({
        kind: "consultation-line",
        text: `Your answer to Dana:\n\n${words}`,
      }),
    );
  });
});

describe("a Consultation whose engine's usage window is used up", () => {
  it("goes on on the Stand-in Engine, where the Consultant answers (spec 5.4)", async () => {
    const resetsAt = new Date("2099-11-13T14:00:00.000Z");
    await startWithStandIn(
      [
        started(...consults("CTO"), ...ASKER_TAKES_THE_ANSWER),
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
          { step: "read-context-usage", usage: { tokens: 32_000, window: 1_000_000 } },
        ),
      ],
      [
        [
          { step: "resume" },
          { step: "send", message: { id: "again", text: "" }, priority: "later" },
          ...usesTool("c-2", ANSWER_CONSULTATION_TOOL, { answers: [{ option: 2 }] }),
          ...aTurn("again", "Done."),
        ],
      ],
    );
    const asker = await developerOnATask();

    const consultation = await consultationOn(asker);
    const answeredAsker = await vi.waitFor(
      async () => {
        const [decision] = await decisions.listInThread(asker.id);
        if (!decision?.answer) throw new Error("Not answered yet.");
        return decision;
      },
      { timeout: 12_000, interval: 20 },
    );
    const settledConsultation = await settled(consultation.id);

    expect(answeredAsker).toMatchObject({ answer: { answeredBy: consultantKey } });
    expect(settledConsultation.session).toMatchObject({
      engineId: HOME.id,
      standInFor: { engineId: FIRST_CLAUDE_CODE_ENGINE.id },
    });
    expect(await threads.messages(consultation.id)).toContainEqual(
      expect.objectContaining({
        kind: "engine-switched",
        fromName: FIRST_CLAUDE_CODE_ENGINE.name,
        toName: HOME.name,
        personName: "Casey",
      }),
    );
    await settled(asker.id);
    // Two sessions and the switch between engines: under the full run's load the answer can take
    // over 5s, so the wait for it and the test get more room than the defaults.
  }, 15_000);
});

describe("a consult on a Task with no worktree yet", () => {
  it("is answered from the Projects' base checkouts, where the Consultant's skills are read", async () => {
    worktreeMade = false;
    missingFolderFailsFor = consultantKey;
    await startWith(
      started(...consults("CTO"), ...ASKER_TAKES_THE_ANSWER),
      started(
        ...usesTool("c-2", ANSWER_CONSULTATION_TOOL, { answers: [{ option: 2 }] }),
        ...aTurn("brief", "Done."),
      ),
    );
    // As BaseCheckouts.refresh makes it, even with no Project checked out.
    await mkdir(join(officeData, "bases"), { recursive: true });
    const asker = await developerOnATask();

    const consultation = await consultationOn(asker);
    await settled(consultation.id);
    const answered = await answeredIn(asker.id);

    expect(answered).toMatchObject({ answer: oneOptionAnswer(1) });
    expect(engine.sessions[1]?.options.folder).toBe(join(officeData, "bases"));
    expect(await threads.messages(consultation.id)).not.toContainEqual(
      expect.objectContaining({ kind: "failure" }),
    );
  });
});

describe("a Consultation that couldn't answer", () => {
  it("leaves the Decision to the user, saying why on its card and in the asker's Thread", async () => {
    // The worktree's folder isn't there, so the Consultant's session never starts.
    missingFolderFailsFor = consultantKey;
    await startWith(started(...consults("CTO")));
    const asker = await developerOnATask();

    const consultation = await consultationOn(asker);
    const decision = await vi.waitFor(
      async () => {
        const [waiting] = (await threads.read(asker.id)).openDecisions;
        if (waiting?.putTo !== undefined) throw new Error("Still put to the Consultant.");
        return waiting;
      },
      { timeout: 5_000, interval: 20 },
    );

    expect(decision).toMatchObject({
      answer: undefined,
      passedOn: [{ roleKey: consultantKey, reason: "Couldn't answer: spawn git ENOENT." }],
    });
    expect(await threads.messages(consultation.id)).toContainEqual(
      expect.objectContaining({ kind: "failure", reason: "spawn git ENOENT" }),
    );
    // The asker's Thread logs the line after the Decision is passed on.
    await vi.waitFor(
      async () =>
        expect(await threads.messages(asker.id)).toContainEqual(
          expect.objectContaining({
            kind: "consultation-line",
            decisionId: decision?.id,
            text: "Casey couldn't answer: spawn git ENOENT. The Decision waits on the user now.",
          }),
        ),
      { timeout: 5_000, interval: 20 },
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
  return app.get(ThreadRunner).send(opened.id, said, ANN_LEE);
}

/** The Consultations in the person's chat, once one has started. */
async function consultationInChatOf(roleKey: string): Promise<Thread> {
  return vi.waitFor(
    async () => {
      const found = (
        await app.get(ThreadRepository).listIn({ kind: "chat", roleKey: roleKey })
      ).find(({ consultation }) => consultation);
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
          answers: [{ answer: "I drafted a Proposal of the Project's commands." }],
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
        ...oneWordsAnswer("I drafted a Proposal of the Project's commands."),
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
      `Riley answered your request:\n\n1. Set up the Project's commands.\n   Answer, in their own words: I drafted a Proposal of the Project's commands.`,
    );
    const lines = (await threads.messages(consultation.id))
      .filter((message) => message.kind === "consultation-line")
      .map((line) => line.kind === "consultation-line" && line.text);
    expect(lines).toEqual([
      "Dana asks you to: Set up the Project's commands.",
      "Your answer to Dana:\n\n1. Set up the Project's commands.\n   Answer, in their own words: I drafted a Proposal of the Project's commands.",
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
      ...consultationOfficeTools(
        { held: await duties.heldBy(devopsKey), caretaker: false },
        {
          canCall: true,
          onTask: false,
          runEnvironment: false,
        },
      ),
    ]);
    expect(calleeSession?.options.profile).toMatchObject({
      edit: false,
      run: { kind: "read-only-git" },
    });
    expect(calleeSession?.options.workstation).toBe(false);
    expect(calleeSession?.options.readsEngineTranscripts).toBe(false);
  });

  it("waits on the user inline in the chat when it names nobody who can be called", async () => {
    await startWith(started(...requests("Janitor"), ...aTurn("brief", "I asked the user.")));
    const caller = await aChatWith(askerKey, "Ask the janitor.");

    await settled(caller.id);

    expect(toolResultOf(engine.sessions[0], "c-1")).toMatchObject({
      isError: false,
      text: expect.stringContaining("The Office put your consult to the user in place of Janitor"),
    });
    const [waiting] = (await threads.read(caller.id)).openDecisions;
    expect(waiting).toMatchObject({
      kind: "request",
      taskId: undefined,
      putTo: undefined,
      answer: undefined,
    });
    expect(await decisions.listOpen()).not.toContainEqual(
      expect.objectContaining({ id: waiting?.id }),
    );
  });

  it("waits on the user inline in the chat when the callee passes it on to the user", async () => {
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
      ),
      started(
        ...usesTool("c-2", ANSWER_CONSULTATION_TOOL, {
          passOn: { why: "It changes the machine." },
        }),
        ...aTurn("brief", "Passed on."),
      ),
    );
    const caller = await aChatWith(askerKey, "Ask Devops whether ffmpeg may be installed.");

    const waiting = await waitingOnTheUserIn(caller.id);
    await settled(caller.id);

    expect(waiting).toMatchObject({
      kind: "approval",
      taskId: undefined,
      answer: undefined,
      passedOn: [{ roleKey: devopsKey, reason: "It changes the machine." }],
    });
    expect(await decisions.listOpen()).not.toContainEqual(
      expect.objectContaining({ id: waiting.id }),
    );
    expect(engine.sessions[0]?.received.find((step) => step.step === "send")).toBeUndefined();
  });

  it("waits on the user inline in the chat when the callee's Consultation couldn't answer", async () => {
    await startWith(
      started(...requests("Devops")),
      // The callee's session ends before its answer is finished: a failure.
      started({
        step: "event",
        event: { kind: "text", text: "Let me", withinToolCall: undefined },
      }),
    );
    const caller = await aChatWith(askerKey, "Ask Devops to set that up.");

    const waiting = await waitingOnTheUserIn(caller.id);

    expect(waiting).toMatchObject({
      taskId: undefined,
      answer: undefined,
      passedOn: [{ roleKey: devopsKey }],
    });
    // The line is logged just after the Decision turns to the user.
    await vi.waitFor(async () =>
      expect(await threads.messages(caller.id)).toContainEqual(
        expect.objectContaining({
          kind: "consultation-line",
          decisionId: waiting.id,
          text: expect.stringContaining("The Decision waits on the user now."),
        }),
      ),
    );
    expect(engine.sessions[0]?.received.find((step) => step.step === "send")).toBeUndefined();
  });
});

/** The Thread's Decision once it no longer waits on a Consultant but on the user. */
async function waitingOnTheUserIn(threadId: string) {
  return vi.waitFor(
    async () => {
      const [waiting] = (await threads.read(threadId)).openDecisions;
      if (!waiting || waiting.putTo !== undefined) throw new Error("Not the user's yet.");
      return waiting;
    },
    { timeout: 5_000, interval: 20 },
  );
}

/** The asker's shaping Thread on a new Initiative, where they start on the user's ask at once. */
function onAnInitiative(): Promise<Thread> {
  return threads.startOnInitiative({
    initiativeId: randomUUID(),
    roleKey: askerKey,
    title: "Shaping",
    opening: "Ask Devops to set that up.",
  });
}

describe("a call from an Initiative's Thread", () => {
  it("opens the callee's Consultation in their own chat when it names no Task", async () => {
    await startWith(started(...requests("Devops")), started(...aTurn("brief", "Looking.")));
    const caller = await onAnInitiative();

    const consultation = await consultationInChatOf(devopsKey);
    await settled(caller.id);

    expect(consultation).toMatchObject({
      home: { kind: "chat", roleKey: devopsKey },
      consultation: { askerThreadId: caller.id },
    });
    expect((await threads.read(caller.id)).openDecisions).toMatchObject([
      { taskId: undefined, putTo: devopsKey },
    ]);
  });

  it("opens it on the Task a planning Thread's call names, as its Decisions are", async () => {
    const taskId = randomUUID();
    await startWith(
      started(
        ...usesTool("c-1", CONSULT_TOOL, {
          person: "Devops",
          kind: "request",
          question: "Set up the Project's commands.",
          context: "The Task needs them.",
          why: "I can't draft Project commands.",
          taskId,
        }),
        ...aTurn("brief", "I asked them."),
      ),
      started(...aTurn("brief", "Looking.")),
    );
    const caller = await onAnInitiative();

    const consultation = await vi.waitFor(
      async () => {
        const found = (await threads.listOnTask(taskId)).find((thread) => thread.consultation);
        if (!found) throw new Error("No Consultation yet.");
        return found;
      },
      { timeout: 5_000, interval: 20 },
    );
    await settled(caller.id);

    expect(consultation).toMatchObject({ home: { kind: "task", taskId }, roleKey: devopsKey });
  });

  it("refuses one naming nobody who can be called and no Task, having nowhere to ask the user", async () => {
    await startWith(started(...requests("Janitor"), ...aTurn("brief", "I'll ask the user.")));
    const caller = await onAnInitiative();

    await settled(caller.id);

    expect(toolResultOf(engine.sessions[0], "c-1")).toMatchObject({
      isError: true,
      text: "Nobody who can be called fills that Role: ask the user in your answer instead.",
    });
  });
});

describe("a call from a Consultation", () => {
  it("nests: the callee calls a third person, whose answer comes back down the chain", async () => {
    await startWith(
      started(...requests("Devops"), ...ASKER_TAKES_THE_ANSWER),
      started(
        ...usesTool("c-2", CONSULT_TOOL, {
          person: "CTO",
          context: "Before I draft the commands.",
          questions: [
            {
              question: QUESTION,
              options: OPTIONS,
              recommended: 2,
              why: "It is what the Projects use.",
            },
          ],
        }),
        ...aTurn("brief", "I asked the CTO."),
        { step: "send", message: { id: "cto-answer", text: "" }, priority: "later" },
        ...usesTool("c-4", ANSWER_CONSULTATION_TOOL, {
          answers: [{ answer: "Drafted, for Postgres." }],
        }),
        ...aTurn("cto-answer", "Done."),
      ),
      started(
        ...usesTool("c-3", ANSWER_CONSULTATION_TOOL, { answers: [{ option: 2 }] }),
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
      ...oneWordsAnswer("Drafted, for Postgres."),
      answeredBy: devopsKey,
    });
    const [, devopsSession, ctoSession] = engine.sessions;
    expect(devopsSession?.options.officeTools.map(({ name }) => name)).toContain(CONSULT_TOOL);
    // The chain has asked two people: the CTO can call nobody else.
    expect(ctoSession?.options.officeTools.map(({ name }) => name)).not.toContain(CONSULT_TOOL);
  });

  it("gets The Office's answer when its call on no Task is passed on to the user", async () => {
    await startWith(
      started(...requests("Devops")),
      started(
        ...usesTool("c-2", CONSULT_TOOL, {
          person: "CTO",
          kind: "approval",
          question: "Install ffmpeg on the machine.",
          context: "Video exports need it.",
          why: "No other way.",
        }),
        ...aTurn("brief", "I asked the CTO."),
        { step: "send", message: { id: "office-answer", text: "" }, priority: "later" },
        ...aTurn("office-answer", "I'll tell Dana."),
      ),
      started(
        ...usesTool("c-3", ANSWER_CONSULTATION_TOOL, {
          passOn: { why: "It changes the machine." },
        }),
        ...aTurn("brief", "Passed on."),
      ),
    );
    await aChatWith(askerKey, "Ask Devops to set that up.");

    const devopsConsultation = await consultationInChatOf(devopsKey);
    const answered = await answeredIn(devopsConsultation.id);
    await settled(devopsConsultation.id);

    expect(answered).toMatchObject({ taskId: undefined, putTo: undefined });
    expect(answered.answer).toMatchObject({
      kind: "asked-again",
      generalComment:
        "Casey passed it on to the user: It changes the machine. So it is the user's now: ask them in your reply.",
      byTheOffice: true,
    });
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

describe("a request to the asker's own Role", () => {
  it("is refused in plain words, putting nothing to the user", async () => {
    await startWith();
    const { thread } = startStageThread(
      randomUUID(),
      { taskId: randomUUID(), roleKey: askerKey, title: "Implement · Dana" },
      new Date(),
    );
    const stageSession = { ...SESSION, id: randomUUID(), roleKey: askerKey };
    await app.get(ThreadRepository).add({ ...thread, state: "answering", session: stageSession });

    for (const person of ["Developer", "Dana", askerKey]) {
      await expect(
        consultations.put(stageSession.id, {
          kind: "request",
          person,
          request: "Create a Task for the logout page.",
          context: "",
          why: "The user asked for one.",
        }),
      ).rejects.toThrow(
        "You are the Developer: a request to yourself is never needed. Do it with your own tools, or tell the user plainly what you can't do and why.",
      );
    }
    expect(await decisions.openInThread(thread.id)).toEqual([]);
  });
});
