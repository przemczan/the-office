import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { ANSWER_CONSULTATION_TOOL, CONSULT_TOOL } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { RoleCards, type SessionRole } from "../../people/index.js";
import { SessionSkills } from "../../skills/index.js";
import { DecisionOfficeTools } from "../adapters/office-tools/decision-office-tools.js";
import { PostgresThreadRepository } from "../adapters/postgres/postgres-thread-repository.js";
import {
  ANSWER_CONSULTATION_TOOL as SESSION_ANSWER_TOOL,
  CONSULTATION_OFFICE_TOOLS,
} from "../domain/session-instructions.js";
import type { Decision } from "../domain/decision.js";
import type { Thread } from "../domain/thread.js";
import { ConversationsSettings } from "../ports/conversations-settings.js";
import { ConversationsSettingsForTests } from "../ports/conversations-settings.fixtures.js";
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
import { ThreadRunner } from "./thread-runner.js";
import { MentionedRecords } from "./mentioned-records.js";
import { WorkRecords } from "./work-records.js";
import { ThreadService } from "./thread-service.js";

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

function roleOf(roleKey: string): SessionRole {
  const consultant = { sharedMemory: false, chat: true, consultant: true };
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
              capabilities: { sharedMemory: false, chat: true, consultant: false },
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
      { provide: ProjectBases, useValue: bases },
      { provide: SessionSkills, useValue: sessionSkills },
      { provide: ConversationsSettings, useValue: new ConversationsSettingsForTests() },
      ContextPolicySettingsService,
      ThreadService,
      Briefs,
      sessionMemoryProvider(),
      TaskThreadSetups,
      InitiativeThreadSetups,
      SessionPlaces,
      ThreadContexts,
      ThreadRunner,
      MentionedRecords,
      WorkRecords,
      StageThreads,
      StageDecisions,
      InterruptedAnswers,
      DecisionService,
      Consultations,
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
    setUp: ({ taskId }) =>
      Promise.resolve({
        folder: join(officeData, "worktrees", taskId),
        environment: {},
        useProjectSkills: false,
        projectId: "admin-panel",
        instructions: "On this Task you build.",
        officeTools: ["read_task", CONSULT_TOOL],
        brief: `You work on the Task ${taskId}.`,
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

const CALL = "Install ffmpeg on the machine.";

/** The developer asks Devops to approve a call, then ends their turn. */
const ASKS_DEVOPS_TO_APPROVE: Step[] = [
  ...usesTool("c-1", CONSULT_TOOL, {
    person: "Devops",
    approval: true,
    question: CALL,
    context: "The export renders video.",
    why: "The export needs ffmpeg.",
  }),
  ...aTurn("brief", "I asked."),
];

/** A Consultant passes the approval on to `person`, then ends their turn. */
function passesOnTo(person: string, why: string): Step[] {
  return [
    ...usesTool("c-2", ANSWER_CONSULTATION_TOOL, { passOn: { person, why } }),
    ...aTurn("brief", "Passed on."),
  ];
}

/** The asker's Decision once it waits on the user. */
async function putToTheUser(asker: Thread): Promise<Decision> {
  return vi.waitFor(
    async () => {
      const open = (await decisions.listOpen()).find(({ threadId }) => threadId === asker.id);
      if (!open) throw new Error("Not the user's yet.");
      return open;
    },
    { timeout: 5_000, interval: 20 },
  );
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
  return threads.startOnTask({
    taskId: randomUUID(),
    roleKey: askerKey,
    title: "Build the export",
    opening: "Build the export.",
  });
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

  it("does not wait on the user while the Consultant has it", async () => {
    await startWith(started(...consults("CTO")), started());
    const asker = await developerOnATask();

    await consultationOn(asker);
    await settled(asker.id);

    expect((await decisions.listOpen()).filter(({ threadId }) => threadId === asker.id)).toEqual(
      [],
    );
    await expect(decisions.openOn((asker.home as { taskId: string }).taskId)).resolves.toBe(0);
    expect((await threads.read(asker.id)).openDecision).toMatchObject({ putTo: consultantKey });
  });

  it("is taken over by the user answering, after which the Consultant's answer is refused", async () => {
    await startWith(started(...consults("CTO"), ...ASKER_TAKES_THE_ANSWER), started());
    const asker = await developerOnATask();
    const consultation = await consultationOn(asker);
    await settled(asker.id);
    const open = (await threads.read(asker.id)).openDecision;
    if (!open) throw new Error("No Decision was put.");

    await decisions.answer(open.id, { kind: "option", option: 0 });
    await settled(asker.id);

    const [askerSession] = engine.sessions;
    const answer = askerSession?.received.find((step) => step.step === "send");
    expect(answer?.step === "send" && answer.message.text).toBe(
      `The user answered your Decision "${QUESTION}" with the option "SQLite".`,
    );
    const consultantSessionId = await vi.waitFor(async () => {
      const session = (await threads.read(consultation.id)).session;
      if (!session) throw new Error("The Consultant has no session yet.");
      return session.id;
    });
    await expect(
      consultations.answer(consultantSessionId, { kind: "option", option: 1 }),
    ).rejects.toThrow(/answered already/);
  });
});

describe("a consult of someone who can't be consulted", () => {
  it("falls back to the user, who is asked in the Consultant's place", async () => {
    await startWith(started(...consults("Nobody Hired"), ...ASKER_TAKES_THE_ANSWER));
    const asker = await developerOnATask();
    await settled(asker.id);
    await vi.waitFor(async () => {
      if (!(await decisions.listOpen()).some(({ threadId }) => threadId === asker.id))
        throw new Error("Not asked yet.");
    });

    const open = (await decisions.listOpen()).find(({ threadId }) => threadId === asker.id);
    expect(open).toMatchObject({ threadId: asker.id, putTo: undefined });
    expect(open?.context).toContain("For Nobody Hired:");
    const onTask = await threads.listOnTask((asker.home as { taskId: string }).taskId);
    expect(onTask.filter(({ consultation }) => consultation)).toEqual([]);
  });
});

describe("an approval passed on", () => {
  it("goes up at most two steps: Devops passes it to the CTO, whose Pass on makes it the user's", async () => {
    await startWith(
      started(...ASKS_DEVOPS_TO_APPROVE),
      started(...passesOnTo("CTO", "It changes the machine every Project builds on.")),
      started(...passesOnTo("Architect", "Only the user decides what the machine runs.")),
    );
    const asker = await developerOnATask();

    const open = await putToTheUser(asker);

    expect(open.putTo).toBeUndefined();
    expect(open.passedOn.map(({ roleKey, reason }) => ({ roleKey, reason }))).toEqual([
      { roleKey: devopsKey, reason: "It changes the machine every Project builds on." },
      { roleKey: consultantKey, reason: "Only the user decides what the machine runs." },
    ]);
    const asked = await consultationsOn(asker);
    expect(asked.map(({ title }) => title).toSorted()).toEqual([
      "Consultation · Dana and Casey",
      "Consultation · Dana and Riley",
    ]);
    const ctoOpening = engine.sessions[2]?.received[0];
    expect(ctoOpening?.step === "start" && ctoOpening.brief.text).toContain(
      "Riley passed it on to you: It changes the machine every Project builds on.",
    );
    const devopsSession = asked.find(({ roleKey }) => roleKey === devopsKey)?.session;
    if (!devopsSession) throw new Error("Devops had no session.");
    await expect(
      consultations.answer(devopsSession.id, { kind: "option", option: 0 }),
    ).rejects.toThrow(/answered already|passed this Decision on/);
  });

  it("falls back to the user when passed on to someone who isn't hired", async () => {
    await startWith(
      started(...ASKS_DEVOPS_TO_APPROVE),
      started(...passesOnTo("Nobody Hired", "Security decides installs.")),
    );
    const asker = await developerOnATask();

    const open = await putToTheUser(asker);

    expect(open).toMatchObject({ putTo: undefined, question: `Allow this call? ${CALL}` });
    expect(open.passedOn).toEqual([
      { roleKey: devopsKey, reason: "Security decides installs.", passedOnAt: expect.any(Date) },
    ]);
    expect(await consultationsOn(asker)).toHaveLength(1);
  });
});

async function answeredOn(asker: Thread): Promise<Decision> {
  return vi.waitFor(
    async () => {
      const [decision] = await decisions.listInThread(asker.id);
      if (!decision?.answer) throw new Error("Not answered yet.");
      return decision;
    },
    { timeout: 5_000, interval: 20 },
  );
}

describe("The Office's Decision put to the CTO first", () => {
  const FAILED = {
    question: '"measure" failed, and its rounds are used up. What now?',
    context: "2 tests fail.",
    options: ["Allow 1 more round", "Continue with the issues recorded", "Drop the Task"],
    recommendation: { option: 0, reason: "Another round may fix it." },
  };
  const WORKING: SessionScript = started(...aTurn("brief", "Working."));

  async function failureOn(asker: Thread, putTo: string): Promise<string | undefined> {
    await settled(asker.id);
    const opened = await app.get(StageDecisions).open({
      taskId: (asker.home as { taskId: string }).taskId,
      threadId: asker.id,
      draft: FAILED,
      putTo,
    });
    return opened.putTo;
  }

  it("opens the CTO's Consultation at once, who answers in their own words, never with the user's options", async () => {
    await startWith(
      WORKING,
      started(
        ...usesTool("c-2", ANSWER_CONSULTATION_TOOL, { option: 3 }),
        ...usesTool("c-3", ANSWER_CONSULTATION_TOOL, { answer: "Mock the clock." }),
        ...aTurn("brief", "Sent back."),
      ),
    );
    const asker = await developerOnATask();

    const putTo = await failureOn(asker, consultantKey);
    const consultation = await consultationOn(asker);
    const answered = await answeredOn(asker);

    expect(putTo).toBe(consultantKey);
    expect(consultation).toMatchObject({
      title: "Consultation · The Office and Casey",
      consultation: { askerThreadId: asker.id },
    });
    expect(consultation.consultation?.askerRoleKey).toBeUndefined();
    const opening = engine.sessions[1]?.received[0];
    const brief = opening?.step === "start" ? opening.brief.text : "";
    expect(brief).toContain("The Office asks for your answer on this Task before the user's.");
    expect(brief).toContain("2 tests fail.");
    const [refused] =
      engine.sessions[1]?.reportedEvents.filter((event) => event.kind === "tool-result") ?? [];
    expect(refused).toMatchObject({ isError: true });
    expect(refused?.kind === "tool-result" && refused.text).toContain(
      "Its options are the user's.",
    );
    expect(answered).toMatchObject({
      roleKey: undefined,
      putTo: consultantKey,
      answer: { kind: "free-answer", text: "Mock the clock.", answeredBy: consultantKey },
    });
  });

  it("waits on the user once the CTO passes it on, with every option theirs", async () => {
    await startWith(
      WORKING,
      started(...passesOnTo("Devops", "Whether to drop the Task is the user's call.")),
    );
    const asker = await developerOnATask();
    await failureOn(asker, consultantKey);

    const open = await putToTheUser(asker);

    expect(open).toMatchObject({ putTo: undefined, options: FAILED.options });
    expect(open.passedOn.map(({ roleKey }) => roleKey)).toEqual([consultantKey]);
    expect(await consultationsOn(asker)).toHaveLength(1);
  });

  it("goes to the user when nobody who can be consulted fills the Role", async () => {
    await startWith(WORKING);
    const asker = await developerOnATask();

    const putTo = await failureOn(asker, `cto-${randomUUID()}`);

    expect(putTo).toBeUndefined();
    expect(await putToTheUser(asker)).toMatchObject({ question: FAILED.question });
    expect(await consultationsOn(asker)).toEqual([]);
  });
});
