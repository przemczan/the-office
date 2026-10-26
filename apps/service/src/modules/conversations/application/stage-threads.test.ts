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
import { CONSULT_TOOL, OPEN_DECISION_TOOL } from "@the-office/contracts";
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
import { TaskTokens } from "./task-tokens.js";
import { TaskThreadSetups } from "./task-thread-setups.js";
import { CONTEXT_POLICY_SETTINGS } from "./thread-contexts.js";
import { ThreadRunner } from "./thread-runner.js";
import { ThreadService } from "./thread-service.js";

type Step = SessionScript[number];

const OUTPUT_SCHEMA = { type: "object" };
const PROFILE = { edit: true, run: { kind: "anything" }, web: false } as const;
const USAGE = { input: 3, output: 120, cacheRead: 9_000, cacheCreation: 26_000 };

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
  await startOn(new ScriptedEngine(scripts));
}

async function startOn(scripted: ScriptedEngine): Promise<void> {
  engine = scripted;
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
    roleKey: "unset",
    stageName: "Implement",
    declared: "fresh",
    previousThreadId: undefined,
    carryMessagesSince: undefined,
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

  it("tells each turn's tokens, which count toward all of the Task's", async () => {
    await startWith(started(...aTurn({ status: "done" })));
    const request = aStage({ roleKey: aPerson("Ada") });
    await anAnsweredDecision(request.taskId, aPerson("Jan"));

    const { turn } = await aStageRun(request);

    expect(turn.tokens).toEqual(USAGE);
    // Every Thread on the Task counts, without cache reads; the planning Thread here never had a
    // turn, so adds none.
    expect(await app.get(TaskTokens).tokensSoFar(request.taskId)).toBe(3 + 120 + 26_000);
  });

  it("refuses the user's messages in a Stage Thread once its Stage has ended", async () => {
    await startWith(started(...aTurn({ status: "done" })));
    const { stageThread } = await aStageRun(aStage({ roleKey: aPerson("Ada") }));

    await expect(app.get(ThreadRunner).send(stageThread.threadId, "Hello?")).rejects.toThrow(
      ThreadRefused,
    );
  });
});

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
    await stageThread.end({ handoverNote: undefined, failure: undefined });
    // One session took it, and no other start or resume: the scripted engine refuses a send of
    // any other priority.
    const steps = engine.sessions.flatMap(({ received }) => received.map(({ step }) => step));
    expect(steps.filter((step) => step !== "read-context-usage")).toEqual(["start", "send", "end"]);
  });

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
    await stageThread.end({ handoverNote: undefined, failure: undefined });
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
    await stageThread.end({ handoverNote: undefined, failure: undefined });
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
    await stageThread.end({ handoverNote: undefined, failure: undefined });
  });
});

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
    await stageThread.end({ handoverNote: undefined, failure: "Stopped by the user." });
    expect(receivedSteps()).toEqual(["start", "interrupt", "end"]);
    expect((await threadOf(stageThread.threadId)).tokens.output).toBe(USAGE.output);
  });

  it("ends the session instead on an engine that can't interrupt", async () => {
    const command = aCommand("npm-test");
    await startOn(new ScriptedEngine([started(command.call)], { interrupt: false }));
    const stageThread = await stageThreads.open(aStage({ roleKey: aPerson("Ada") }));
    const turn = stageThread.nextTurn();

    await stageThread.interrupt();

    await expect(turn).rejects.toThrow("The session ended before the Stage's turn did.");
    await stageThread.end({ handoverNote: undefined, failure: "Stopped by the user." });
    expect(receivedSteps()).toEqual(["start", "end"]);
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
    await stopped.end({ handoverNote: undefined, failure: "Stopped by the user." });
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
    await again.end({ handoverNote: undefined, failure: undefined });
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

    const asked = await stageThreads.endLeftRunning(left.threadId, failure, since);

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
    await again.end({ handoverNote: undefined, failure: undefined });
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
    await earlier.end({ handoverNote: undefined, failure: undefined });

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

  it("opens The Office's in a Stage Thread, and takes the answer for the Pipeline with no session", async () => {
    await startWith(started(...aTurn({ status: "needs_decision" })));
    const ada = aPerson("Ada");
    const request = aStage({ roleKey: ada });
    const { stageThread } = await aStageRun(request);
    const answered = answeredEvents();

    const id = await app.get(StageDecisions).open({
      taskId: request.taskId,
      threadId: stageThread.threadId,
      draft,
    });
    const thread = await app.get(DecisionService).answer(id, { kind: "option", option: 1 });

    expect(thread.openDecision).toBeUndefined();
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

  it("opens The Office's own in the Task's newest Thread, asked by no person", async () => {
    await startWith();
    const taskId = randomUUID();
    await anAnsweredDecision(taskId, aPerson("Jan"));
    const [planning] = await repository.listIn({ kind: "task", taskId });

    const id = await app.get(StageDecisions).open({
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

/** Calls the Office tool as the Stage Thread's session would, outside a scripted turn. */
async function callInStage(threadId: string, name: string, input: Record<string, unknown>) {
  const sessionId = (await threadOf(threadId)).session?.id ?? "";
  const [tool] = app.get(OfficeToolRegistry).named([name]);
  if (!tool) throw new Error(`No Office tool ${name}.`);
  return tool.run(tool.input.parse(input), { sessionId });
}

const WHICH_PAGE = {
  question: "Which page shows the rename?",
  context: "Both pages list devices.",
  options: ["The device page", "The list"],
  recommended: 1,
  why: "It has the room.",
};

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
    // While the Stage runs, its walk hasn't taken the Decision up yet.
    await expect(
      app.get(DecisionService).answer(id, { kind: "option", option: 0 }),
    ).rejects.toThrow(new ThreadRefused(["The Stage is still running. Answer once it has ended."]));
    await stageThread.end({ handoverNote: "Waiting.", failure: undefined });
    const answered = answeredEvents();

    await app.get(DecisionService).answer(id, { kind: "option", option: 0 });

    expect(answered.map((event) => event.decision.id)).toEqual([id]);
    expect(await repository.decision(id)).toMatchObject({ roleKey: ada, answer: { option: 0 } });
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
    await first.end({ handoverNote: undefined, failure: undefined });
    await app.get(DecisionService).answer(earlier?.id ?? "", { kind: "option", option: 1 });

    const again = await stageThreads.open({
      ...request,
      declared: undefined,
      previousThreadId: first.threadId,
    });
    await again.nextTurn();
    const asked = await again.askedDecision();
    await again.end({ handoverNote: undefined, failure: undefined });

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
      "The Office restarted during this Stage.",
      since,
    );

    expect(asked).toMatchObject({ question: "Which page shows the rename?" });
    expect((await threadOf(left.threadId)).openDecision?.id).toBe(asked?.id);
    await expect(
      stageThreads.endLeftRunning(left.threadId, "Again.", new Date(Date.now() + 1_000)),
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
        "For Devops: The Office has no Consultations yet, so you answer in their place.\n\nIt speeds the build up by a minute.",
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
