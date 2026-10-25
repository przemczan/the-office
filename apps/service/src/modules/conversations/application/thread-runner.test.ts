import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../platform/websocket/event-stream.module.js";
import { ScriptedEngine, ScriptedEngineModule, type SessionScript } from "../../engine/index.js";
import { RoleCards, type SessionRole } from "../../people/index.js";
import { SessionSkills } from "../../skills/index.js";
import { PostgresThreadRepository } from "../adapters/postgres/postgres-thread-repository.js";
import { HANDOVER_REQUEST } from "../domain/chat-instructions.js";
import { TurnEnded } from "../domain/conversation-events.js";
import { DEFAULT_CONTEXT_POLICY_SETTINGS, type ContextDecision } from "../domain/context-policy.js";
import type { BriefProject } from "../domain/brief.js";
import type { Message, MessageDraft } from "../domain/message.js";
import type { Thread, ThreadSession } from "../domain/thread.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import { ProjectBases } from "../ports/project-bases.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { Briefs } from "./briefs.js";
import { InterruptedAnswers } from "./interrupted-answers.js";
import { aPlannerCard } from "./session-role.fixtures.js";
import { CONTEXT_POLICY_SETTINGS, ThreadContexts } from "./thread-contexts.js";
import { ThreadRunner } from "./thread-runner.js";
import { ThreadService } from "./thread-service.js";

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
let roleKey: string;
let threads: ThreadService;
let runner: ThreadRunner;
let repository: ThreadRepository;
/** The sessions whose skills were forgotten, as each was replaced. */
let forgotten: string[];

const PROJECTS: BriefProject[] = [
  { name: "Admin panel", baseBranch: "main", folder: "/office/bases/admin-panel" },
];

beforeEach(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-threads-"));
  versions = [PLANNER];
  roleKey = `role-${randomUUID()}`;
});

afterEach(async () => {
  await app.close();
  await rm(officeData, { recursive: true, force: true });
});

/** Boots the runner on a scripted engine that replays `scripts`, one per session opened. */
async function startWith(...scripts: SessionScript[]): Promise<void> {
  engine = new ScriptedEngine(scripts);
  forgotten = [];
  // The library is shared by every test file, so the sessions here get no skills of it.
  const sessionSkills: Pick<SessionSkills, "prepare" | "rebuild" | "forget"> = {
    prepare: ({ sessionId }) => Promise.resolve(noSkills(sessionId)),
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
    folder: join(officeData, "bases"),
    list: () => Promise.resolve(PROJECTS),
    refresh: () => Promise.resolve(PROJECTS),
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
      { provide: CONTEXT_POLICY_SETTINGS, useValue: DEFAULT_CONTEXT_POLICY_SETTINGS },
      ThreadService,
      Briefs,
      ThreadContexts,
      ThreadRunner,
      InterruptedAnswers,
    ],
  }));
  threads = app.get(ThreadService);
  runner = app.get(ThreadRunner);
  repository = app.get(ThreadRepository);
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
  return { roleKey, cardVersion: version, card };
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

function contextLine(decision: Partial<ContextDecision>): MessageDraft {
  return {
    kind: "context",
    move: decision.move ?? "fresh",
    reason: decision.reason ?? "new-thread",
    contextTokens: decision.contextTokens ?? 0,
    briefTokens: decision.briefTokens,
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

    const answering = await runner.send(thread.id, "Read the deploy workflow.");
    const log = await answered(thread.id, 5);

    expect(answering.state).toBe("answering");
    const [session] = engine.sessions;
    const brief = session?.received[0];
    expect(brief?.step === "start" && brief.brief.text).toMatch(
      /in a new Thread[\s\S]*Admin panel: its main branch[\s\S]*## The user's message\n\nRead the deploy workflow\.$/,
    );
    expect(session?.options).toMatchObject({
      folder: join(officeData, "bases"),
      environment: {},
      model: "claude-opus-5-5",
      effort: "high",
      profile: { edit: false, run: { kind: "read-only-git" }, web: true },
      officeTools: [],
    });
    expect(session?.options.instructions).toContain("You are Jan, the Planner in The Office");
    expect(session?.options.instructions).toContain("Plan in conversation: ask what is unclear.");
    expect(drafts(log)).toEqual([
      contextLine({ move: "fresh", reason: "new-thread", briefTokens: expect.any(Number) }),
      { kind: "user", text: "Read the deploy workflow." },
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
      session: { id: session?.id, roleKey, cardVersion: 1, contextTokens: 32_000, full: false },
    });
  });
});

describe("continuing a Thread", () => {
  it("sends a message within the hour to the running session, with no context line", async () => {
    await startWith(started(...aTurn("brief", "Hello."), sent("m-2"), ...aTurn("m-2", "Sure.")));
    const thread = await threads.startInChat(roleKey);
    await runner.send(thread.id, "Hello.");
    await answered(thread.id, 3);

    await runner.send(thread.id, "And the tests?");
    const log = await answered(thread.id, 5);

    expect(engine.sessions).toHaveLength(1);
    expect(drafts(log).slice(3)).toEqual([
      { kind: "user", text: "And the tests?" },
      { kind: "person", roleKey, text: "Sure." },
    ]);
    expect((await threads.read(thread.id)).tokens.output).toBe(2 * USAGE.output);
  });

  it("resumes a cooled Thread with a small context, on the card version its session started with", async () => {
    await startWith(started(...aTurn("brief", "Hello.")), [
      { step: "resume" },
      sent("m-2"),
      ...aTurn("m-2", "Back again."),
    ]);
    const thread = await threads.startInChat(roleKey);
    await runner.send(thread.id, "Hello.");
    await answered(thread.id, 3);
    // The service restarts, the cache cools, and the card changes meanwhile.
    await runner.onModuleDestroy();
    await cooled(thread.id, 12_000);
    versions.push({ ...PLANNER, model: "claude-sonnet-5-5", effort: "low" });

    await runner.send(thread.id, "Still there?");
    const log = await answered(thread.id, 6);

    const [first, resumed] = engine.sessions;
    expect(resumed?.id).toBe(first?.id);
    expect(resumed?.options).toEqual(first?.options);
    expect(drafts(log).slice(3)).toEqual([
      contextLine({ move: "resume", reason: "small-context", contextTokens: 12_000 }),
      { kind: "user", text: "Still there?" },
      { kind: "person", roleKey, text: "Back again." },
    ]);
  });

  it("starts a cooled Thread with a large context fresh, briefed from its log, on the current card", async () => {
    await startWith(
      started(...aTurn("brief", "It deploys on push.")),
      started(...aTurn("brief", "Yes.")),
    );
    const thread = await threads.startInChat(roleKey);
    await runner.send(thread.id, "Read the deploy workflow.");
    await answered(thread.id, 3);
    await cooled(thread.id, 48_000);
    versions.push({ ...PLANNER, model: "claude-sonnet-5-5" });

    await runner.send(thread.id, "And the tests?");
    const log = await answered(thread.id, 6);

    const [first, fresh] = engine.sessions;
    expect(fresh?.id).not.toBe(first?.id);
    expect(forgotten).toEqual([first?.id]);
    expect(fresh?.options.model).toBe("claude-sonnet-5-5");
    const brief = fresh?.received[0];
    expect(brief?.step === "start" && brief.brief.text).toMatch(
      /in a fresh session[\s\S]*## The Thread\n\nRead the deploy workflow[\s\S]*The user: Read the deploy workflow\.\n\nYou: It deploys on push\.[\s\S]*## The user's message\n\nAnd the tests\?$/,
    );
    expect(drafts(log)[3]).toEqual(
      contextLine({
        move: "fresh",
        reason: "cache-expired",
        contextTokens: 48_000,
        briefTokens: expect.any(Number),
      }),
    );
    expect((await threads.read(thread.id)).session).toMatchObject({
      id: fresh?.id,
      cardVersion: 2,
    });
  });

  it("starts fresh while the cache is warm when the user chose Start fresh, once", async () => {
    await startWith(started(...aTurn("brief", "Hello.")), started(...aTurn("brief", "Fresh.")));
    const thread = await threads.startInChat(roleKey);
    await runner.send(thread.id, "Hello.");
    await answered(thread.id, 3);

    await threads.chooseOverride(thread.id, "start-fresh");
    await runner.send(thread.id, "Start over.");
    const log = await answered(thread.id, 6);

    expect(engine.sessions).toHaveLength(2);
    expect(drafts(log)[3]).toMatchObject({ kind: "context", move: "fresh", reason: "your-choice" });
    expect((await threads.read(thread.id)).override).toBeUndefined();
  });

  it("refuses a message while the person is still answering", async () => {
    await startWith(started(sent("never")));
    const thread = await threads.startInChat(roleKey);
    await runner.send(thread.id, "Hello.");

    await expect(runner.send(thread.id, "Hello again.")).rejects.toThrow(
      new ThreadRefused(["Jan is still answering. Send it once they finish."]),
    );
  });

  it("refuses to continue once the person's Chat is off, keeping the Thread readable", async () => {
    await startWith(started(...aTurn("brief", "Hello.")));
    const thread = await threads.startInChat(roleKey);
    await runner.send(thread.id, "Hello.");
    await answered(thread.id, 3);
    versions.push({ ...PLANNER, capabilities: { ...PLANNER.capabilities, chat: false } });

    await expect(runner.send(thread.id, "Hello again.")).rejects.toThrow(ThreadRefused);
    await expect(threads.messages(thread.id)).resolves.toHaveLength(3);
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

describe("when a session doesn't answer", () => {
  it("puts back the session the Thread had when a new one fails to start", async () => {
    // No script: the engine refuses to start the session.
    await startWith();
    const thread = await threads.startInChat(roleKey);

    await runner.send(thread.id, "Hello.");
    const after = await waiting(thread.id);

    expect(after.session).toBeUndefined();
    expect(drafts(await threads.messages(thread.id)).at(-1)).toMatchObject({ kind: "failure" });
    await expect(app.get(ThreadContexts).of(after)).resolves.toMatchObject({
      move: "fresh",
      reason: "new-thread",
    });
  });

  it("waits for the user again when the session ends before the answer is finished", async () => {
    await startWith(
      started({
        step: "event",
        event: { kind: "text", text: "Let me", withinToolCall: undefined },
      }),
    );
    const thread = await threads.startInChat(roleKey);

    await runner.send(thread.id, "Hello.");
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
    await runner.send(thread.id, "Hello.");

    await app.get(InterruptedAnswers).recover();

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
    await runner.send(thread.id, "Read everything.");
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

    await runner.send(thread.id, "Go on.");
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
