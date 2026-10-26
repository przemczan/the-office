import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../../platform/telemetry/telemetry.module.js";
import { ScriptedEngine, ScriptedEngineModule, type SessionScript } from "../../engine/index.js";
import { RoleCards, type SessionRole } from "../../people/index.js";
import { SessionSkills } from "../../skills/index.js";
import { PostgresThreadRepository } from "../adapters/postgres/postgres-thread-repository.js";
import { DecisionAnswered } from "../domain/conversation-events.js";
import { DEFAULT_CONTEXT_POLICY_SETTINGS } from "../domain/context-policy.js";
import type { Message, MessageDraft } from "../domain/message.js";
import type { Thread } from "../domain/thread.js";
import { answerDecision, openDecision, startTaskThread } from "../domain/thread-changes.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import { ProjectBases } from "../ports/project-bases.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { Briefs } from "./briefs.js";
import { DecisionService } from "./decision-service.js";
import { aPlannerCard } from "./session-role.fixtures.js";
import { SessionPlaces } from "./session-places.js";
import { StageDecisions } from "./stage-decisions.js";
import { StageThreads, type StageThreadRequest } from "./stage-threads.js";
import { TaskThreadSetups } from "./task-thread-setups.js";
import { CONTEXT_POLICY_SETTINGS } from "./thread-contexts.js";
import { ThreadRunner } from "./thread-runner.js";

type Step = SessionScript[number];

const OUTPUT_SCHEMA = { type: "object" };
const PROFILE = { edit: true, run: { kind: "anything" }, web: false } as const;
const USAGE = { input: 3, output: 120, cacheRead: 0, cacheCreation: 26_000 };

let app: INestApplication;
let engine: ScriptedEngine;
let officeData: string;
let stageThreads: StageThreads;
let repository: ThreadRepository;
/** The people of this test, by Role key, each under a key of its own. */
let people: Map<string, SessionRole>;
let forgotten: string[];

beforeEach(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-stage-threads-"));
  people = new Map();
});

afterEach(async () => {
  await app.close();
  await rm(officeData, { recursive: true, force: true });
});

/** Who fills the Role, as People would answer. */
function personIn(roleKey: string): Promise<SessionRole> {
  const role = people.get(roleKey);
  if (!role) throw new Error(`Nobody fills ${roleKey}.`);
  return Promise.resolve(role);
}

async function startWith(...scripts: SessionScript[]): Promise<void> {
  engine = new ScriptedEngine(scripts);
  forgotten = [];
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
  const roleCards: Pick<RoleCards, "find" | "forNewSession" | "forResumedSession"> = {
    find: (roleKey) => Promise.resolve(people.get(roleKey)),
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
      { provide: ProjectBases, useValue: bases },
      { provide: SessionSkills, useValue: sessionSkills },
      { provide: CONTEXT_POLICY_SETTINGS, useValue: DEFAULT_CONTEXT_POLICY_SETTINGS },
      Briefs,
      TaskThreadSetups,
      SessionPlaces,
      ThreadRunner,
      StageThreads,
      StageDecisions,
      DecisionService,
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
    roleKey: "unset",
    stageName: "Implement",
    declared: "fresh",
    previousThreadId: undefined,
    record: "## The Task\n\nRename a device.",
    work: "## The Stage: Implement\n\nBuild it.",
    folder: join(officeData, "worktrees", "task"),
    environment: { PROJECT_VARIABLE: "set" },
    useProjectSkills: false,
    session: {
      instructions: "You work a Stage.",
      profile: PROFILE,
      officeTools: [],
      outputSchema: OUTPUT_SCHEMA,
    },
    ...fields,
  };
}

/** A turn that writes `text` and ends with `output`. */
function aTurn(output: unknown, text = "Working on it."): Step[] {
  return [
    { step: "event", event: { kind: "text", text, withinToolCall: undefined } },
    {
      step: "event",
      event: {
        kind: "turn-ended",
        outcome: "completed",
        consumedMessageIds: [],
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
  await stageThread.end({ handoverNote, failure: undefined });
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

describe("StageThreads", () => {
  it("starts a Stage in a new Stage Thread with a Brief of the record and the answered Decisions", async () => {
    await startWith(started(...aTurn({ status: "done" })));
    const ada = aPerson("Ada");
    const request = aStage({ roleKey: ada });
    await anAnsweredDecision(request.taskId, ada);

    const { stageThread, turn } = await aStageRun(request);

    expect(turn).toEqual({ output: { status: "done" }, problem: undefined });
    expect(stageThread.move).toMatchObject({ move: "fresh", reason: "new-thread" });
    const thread = await threadOf(stageThread.threadId);
    expect(thread).toMatchObject({
      home: { kind: "task", taskId: request.taskId },
      roleKey: ada,
      title: "Implement · Ada",
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
    const log = drafts(await repository.messages(first.stageThread.threadId));
    expect(log.slice(3)).toEqual([
      expect.objectContaining({ kind: "context", move: "resume", reason: "stage-declared" }),
      { kind: "person", roleKey: ada, text: "Reviewing." },
      { kind: "handover-note", roleKey: ada, text: "Reviewed." },
    ]);
    expect(forgotten).toEqual([]);
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
    expect(thread).toMatchObject({ roleKey: rui, title: "Review · Rui", stageThread: true });
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
    await stageThread.end({ handoverNote: undefined, failure: "It failed anyway." });

    expect(corrected.output).toEqual({ status: "done" });
    const thread = await threadOf(stageThread.threadId);
    expect(thread.tokens.output).toBe(USAGE.output * 2);
    expect(drafts(await repository.messages(thread.id)).slice(2)).toEqual([
      { kind: "failure", reason: "The result was invalid." },
      { kind: "person", roleKey: ada, text: "Corrected." },
      { kind: "failure", reason: "It failed anyway." },
    ]);
  });

  it("ends the session once, before the Stage's work ends in the Thread", async () => {
    await startWith(started(...aTurn({ status: "done" })));
    const stageThread = await stageThreads.open(aStage({ roleKey: aPerson("Ada") }));
    await stageThread.nextTurn();

    await stageThread.endSession();
    const [session] = engine.sessions;
    expect(session?.received.filter(({ step }) => step === "end")).toHaveLength(1);
    expect((await threadOf(stageThread.threadId)).state).toBe("answering");
    await stageThread.end({ handoverNote: "Left: nothing.", failure: undefined });

    expect(session?.received.filter(({ step }) => step === "end")).toHaveLength(1);
    expect((await threadOf(stageThread.threadId)).state).toBe("waiting");
  });

  it("refuses the user's messages in a Stage Thread", async () => {
    await startWith(started(...aTurn({ status: "done" })));
    const { stageThread } = await aStageRun(aStage({ roleKey: aPerson("Ada") }));

    await expect(app.get(ThreadRunner).send(stageThread.threadId, "Hello?")).rejects.toThrow(
      ThreadRefused,
    );
  });
});

/** Every DecisionAnswered published from now on. */
function answeredEvents(): DecisionAnswered[] {
  const answered: DecisionAnswered[] = [];
  app.get(EventBus).subscribeToEveryEvent((event: DomainEvent) => {
    if (event instanceof DecisionAnswered) answered.push(event);
  });
  return answered;
}

describe("StageDecisions", () => {
  const draft = {
    question: "Which page?",
    context: "Both list devices.",
    options: ["The device page", "The list"],
    recommendation: { option: 0, reason: "It has the room." },
  };

  it("opens an Agent's question in its Stage Thread, and takes the answer for the Pipeline with no session", async () => {
    await startWith(started(...aTurn({ status: "needs_decision" })));
    const ada = aPerson("Ada");
    const request = aStage({ roleKey: ada });
    const { stageThread } = await aStageRun(request);
    const answered = answeredEvents();

    const id = await app.get(StageDecisions).open({
      taskId: request.taskId,
      threadId: stageThread.threadId,
      byTheOffice: false,
      draft,
    });
    const thread = await app.get(DecisionService).answer(id, { kind: "option", option: 1 });

    expect(thread.openDecision).toBeUndefined();
    const log = drafts(await repository.messages(stageThread.threadId));
    expect(log.slice(-2)).toEqual([
      { kind: "decision", roleKey: ada, decisionId: id },
      { kind: "decision-answer", decisionId: id, answer: { kind: "option", option: 1 } },
    ]);
    expect(answered.map(({ decision }) => [decision.id, decision.answer?.kind])).toEqual([
      [id, "option"],
    ]);
    // The session ended with the Stage; nothing started another.
    expect(engine.sessions).toHaveLength(1);
    expect(await repository.answeredOn(request.taskId)).toHaveLength(1);
  });

  it("opens The Office's own in the Task's newest Thread, asked by no person", async () => {
    await startWith();
    const taskId = randomUUID();
    await anAnsweredDecision(taskId, aPerson("Jan"));
    const [planning] = await repository.listIn({ kind: "task", taskId });

    const id = await app.get(StageDecisions).open({
      taskId,
      threadId: undefined,
      byTheOffice: true,
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
