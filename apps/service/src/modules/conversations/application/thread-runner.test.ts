import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPEN_DECISION_TOOL } from "@the-office/contracts";
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
import { CHAT_OFFICE_TOOLS, HANDOVER_REQUEST } from "../domain/session-instructions.js";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { TokensCounted, TurnEnded } from "../domain/conversation-events.js";
import type { ContextDecision } from "../domain/context-policy.js";
import type { BriefProject } from "../domain/brief.js";
import type { Message, MessageDraft } from "../domain/message.js";
import { NO_TOKENS, type Thread, type ThreadSession } from "../domain/thread.js";
import { ThreadRefused } from "../domain/thread-refused.js";
import { ProjectBases } from "../ports/project-bases.js";
import { ThreadRepository } from "../ports/thread-repository.js";
import { Briefs } from "./briefs.js";
import { Consultations } from "./consultations.js";
import { sessionMemoryProvider } from "./session-memory.fixtures.js";
import { DecisionService } from "./decision-service.js";
import { InterruptedAnswers } from "./interrupted-answers.js";
import { aPlannerCard } from "./session-role.fixtures.js";
import { SessionPlaces } from "./session-places.js";
import { TaskThreadSetups, type TaskThreadSetup } from "./task-thread-setups.js";
import { ThreadContexts } from "./thread-contexts.js";
import { StageThreads } from "./stage-threads.js";
import { ThreadRunner } from "./thread-runner.js";
import { MentionedRecords } from "./mentioned-records.js";
import { WorkRecords } from "./work-records.js";
import { ThreadService } from "./thread-service.js";
import { ContextPolicySettingsService } from "./context-policy-settings.js";
import { ConversationsSettings } from "../ports/conversations-settings.js";
import { ConversationsSettingsForTests } from "../ports/conversations-settings.fixtures.js";

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
const NO_SESSION_REASON = "This Task is Done, so its conversation can't go on.";
/** Tasks whose setup says no session can work on them (Done: Publish removed the worktree). */
const tasksWithoutSessions = new Set<string>();
/** The records of Tasks and Ideas as the Work module words them, by id. */
const workRecords = new Map<string, string>();

let threads: ThreadService;
let runner: ThreadRunner;
let repository: ThreadRepository;
let decisions: DecisionService;
/** The sessions whose skills were forgotten, as each was replaced. */
let forgotten: string[];
/** What each new session's skills were prepared for. */
let prepared: Parameters<SessionSkills["prepare"]>[0][];

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
  prepared = [];
  // The library is shared by every test file, so the sessions here get no skills of it.
  const sessionSkills: Pick<SessionSkills, "prepare" | "rebuild" | "forget"> = {
    prepare: (request) => {
      prepared.push(request);
      return Promise.resolve(noSkills(request.sessionId));
    },
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
      { provide: ConversationsSettings, useValue: new ConversationsSettingsForTests() },
      ContextPolicySettingsService,
      ThreadService,
      Briefs,
      sessionMemoryProvider(),
      TaskThreadSetups,
      SessionPlaces,
      ThreadContexts,
      ThreadRunner,
      MentionedRecords,
      WorkRecords,
      StageThreads,
      InterruptedAnswers,
      DecisionService,
      Consultations,
      DecisionOfficeTools,
    ],
  }));
  // As the Projects and People modules register theirs.
  for (const name of CHAT_OFFICE_TOOLS) {
    app.get(OfficeToolRegistry).register({
      name,
      description: `Reads ${name}.`,
      input: z.object({}),
      run: () => Promise.resolve({ text: "Nothing.", isError: false }),
    });
  }
  // As the Work module sets up its Tasks' Threads.
  app.get(TaskThreadSetups).provide({
    setUp: ({ taskId }) =>
      Promise.resolve({
        ...taskSetup(taskId),
        sessionRefusal: tasksWithoutSessions.has(taskId) ? NO_SESSION_REASON : undefined,
      }),
  });
  // As the Work module gives its records.
  app.get(WorkRecords).provide({
    taskRecord: (taskId) => Promise.resolve(workRecords.get(taskId)),
    ideaRecord: (ideaId) => Promise.resolve(workRecords.get(ideaId)),
  });
  threads = app.get(ThreadService);
  runner = app.get(ThreadRunner);
  repository = app.get(ThreadRepository);
  decisions = app.get(DecisionService);
}

/** What a session on the Task works with in these tests. */
function taskSetup(taskId: string): TaskThreadSetup {
  return {
    folder: join(officeData, "worktrees", "admin-panel", taskId),
    environment: { PROJECT_VARIABLE: "set" },
    useProjectSkills: true,
    projectId: "admin-panel",
    instructions: "On this Task you plan.",
    officeTools: ["read_task", OPEN_DECISION_TOOL],
    brief: `You are planning the Task ${taskId}.`,
    sessionRefusal: undefined,
  };
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

/** Any Brief's text, as a line keeps it. */
const A_BRIEF: unknown = expect.any(String);

/** The move's line; a move that starts a session with a Brief keeps the Brief's text. */
function contextLine(decision: Partial<ContextDecision>): MessageDraft {
  return {
    kind: "context",
    move: decision.move ?? "fresh",
    reason: decision.reason ?? "new-thread",
    contextTokens: decision.contextTokens ?? 0,
    briefTokens: decision.briefTokens,
    brief: decision.briefTokens === undefined ? undefined : (A_BRIEF as string),
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
    });
    expect(session?.options.officeTools.map(({ name }) => name)).toEqual([...CHAT_OFFICE_TOOLS]);
    expect(session?.options.instructions).toContain("You are Jan, the Planner in The Office");
    // A chat's session is on no Task, so the Office tools writing onto one refuse it.
    await expect(threads.taskInSession(session?.id ?? "")).resolves.toBeUndefined();
    expect(session?.options.instructions).toContain("Plan in conversation: ask what is unclear.");
    expect(drafts(log)).toEqual([
      contextLine({ move: "fresh", reason: "new-thread", briefTokens: expect.any(Number) }),
      { kind: "user", text: "Read the deploy workflow.", delivery: "delivered" },
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
      session: {
        id: session?.id,
        roleKey,
        cardVersion: 1,
        contextTokens: 32_000,
        startContextTokens: 32_000,
        full: false,
      },
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
      { kind: "user", text: "And the tests?", delivery: "delivered" },
      { kind: "person", roleKey, text: "Sure." },
    ]);
    expect((await threads.read(thread.id)).tokens.output).toBe(2 * USAGE.output);
  });

  it("counts the running turn's tokens as they come, then the turn's own", async () => {
    const soFar = { input: 3, output: 40, cacheRead: 9_000, cacheCreation: 0 };
    await startWith(
      started({ step: "event", event: { kind: "turn-tokens", soFar } }, ...aTurn("brief", "Hi.")),
    );
    const counted: Thread[] = [];
    app.get(EventBus).subscribeToEveryEvent((event: DomainEvent) => {
      if (event instanceof TokensCounted) counted.push(event.thread);
    });
    const thread = await threads.startInChat(roleKey);

    await runner.send(thread.id, "Hello.");
    await answered(thread.id, 3);

    expect(counted.map(({ tokens, runningTurnTokens }) => [tokens, runningTurnTokens])).toEqual([
      [NO_TOKENS, soFar],
    ]);
    expect(await threads.read(thread.id)).toMatchObject({
      tokens: USAGE,
      runningTurnTokens: NO_TOKENS,
    });
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
      { kind: "user", text: "Still there?", delivery: "delivered" },
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
    await cooled(thread.id, 80_000);
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
        contextTokens: 80_000,
        briefTokens: expect.any(Number),
      }),
    );
    expect((await threads.read(thread.id)).session).toMatchObject({
      id: fresh?.id,
      cardVersion: 2,
    });
  });

  it("starts a cooled Thread fresh once Settings lowers the size threshold below its context", async () => {
    await startWith(started(...aTurn("brief", "Hello.")));
    const thread = await threads.startInChat(roleKey);
    await runner.send(thread.id, "Hello.");
    await answered(thread.id, 3);
    // 8k more than the session's first turn took.
    await cooled(thread.id, 40_000);
    const contexts = app.get(ThreadContexts);
    const before = await contexts.of(await threads.read(thread.id));

    await app.get(ContextPolicySettingsService).changeSizeThreshold(5_000);
    const after = await contexts.of(await threads.read(thread.id));

    expect(before).toMatchObject({ move: "resume", reason: "small-context" });
    expect(after).toMatchObject({ move: "fresh", reason: "cache-expired" });
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

describe("a Thread on a Task", () => {
  it("stays readable but takes no message once no session can work on its Task", async () => {
    const taskId = randomUUID();
    await startWith(started(...aTurn("brief", "What must be true when it is done?")));
    const opened = await threads.startOnTask({
      taskId,
      roleKey,
      title: "Planning",
      opening: "Plan the Task with the user.",
    });
    await answered(opened.id, 2);
    const before = await threads.messages(opened.id);
    const stateBefore = (await threads.read(opened.id)).state;

    tasksWithoutSessions.add(taskId);

    await expect(runner.send(opened.id, "One more thing.")).rejects.toThrow(
      new ThreadRefused([NO_SESSION_REASON]),
    );
    expect(await threads.messages(opened.id)).toEqual(before);
    expect((await threads.read(opened.id)).state).toBe(stateBefore);
  });

  it("opens on The Office's words in the Task's worktree, read-only, before the user says anything", async () => {
    const taskId = randomUUID();
    const worktree = taskSetup(taskId).folder;
    await startWith(
      started(
        {
          step: "event",
          event: {
            kind: "tool-call",
            callId: "c-1",
            tool: "Read",
            officeTool: false,
            input: { file_path: join(worktree, "README.md") },
            withinToolCall: undefined,
          },
        },
        ...aTurn("brief", "What must be true when it is done?"),
      ),
    );

    const opened = await threads.startOnTask({
      taskId,
      roleKey,
      title: "Planning",
      opening: "Plan the Task with the user.",
    });
    const log = await answered(opened.id, 3);

    expect(opened).toMatchObject({ home: { kind: "task", taskId }, title: "Planning" });
    const [session] = engine.sessions;
    const brief = session?.received[0];
    expect(brief?.step === "start" && brief.brief.text).toBe(
      `You are planning the Task ${taskId}.\n\n## What to do now\n\nPlan the Task with the user.`,
    );
    expect(session?.options).toMatchObject({
      folder: worktree,
      environment: { PROJECT_VARIABLE: "set" },
      profile: { edit: false, run: { kind: "read-only-git" }, web: true },
    });
    expect(session?.options.officeTools.map(({ name }) => name)).toEqual([
      "read_task",
      OPEN_DECISION_TOOL,
    ]);
    expect(session?.options.instructions).toMatch(
      /^You are Jan, the Planner in The Office[\s\S]*\n\nOn this Task you plan\.$/,
    );
    expect(prepared).toEqual([
      { sessionId: session?.id, roleKey, project: { folder: worktree, useProjectSkills: true } },
    ]);
    expect(drafts(log)).toEqual([
      contextLine({ move: "fresh", reason: "new-thread", briefTokens: expect.any(Number) }),
      { kind: "tool-activity", roleKey, tool: "Read", summary: "README.md" },
      { kind: "person", roleKey, text: "What must be true when it is done?" },
    ]);
    // The line keeps the Brief as it was sent, for the user to read.
    expect(log[0]).toMatchObject({
      kind: "context",
      brief: `You are planning the Task ${taskId}.`,
    });
    expect((await threads.read(opened.id)).title).toBe("Planning");
    await expect(threads.taskInSession(session?.id ?? "")).resolves.toBe(taskId);
    await expect(threads.personInSession(session?.id ?? "")).resolves.toBe(roleKey);
  });

  it("ends the Task's waiting sessions before its worktree is removed, and no other Task's", async () => {
    const taskId = randomUUID();
    await startWith(
      started(...aTurn("brief", "What must be true when it is done?"), { step: "end" }),
      started(...aTurn("brief", "Which page?")),
    );
    const planning = await threads.startOnTask({
      taskId,
      roleKey,
      title: "Planning",
      opening: "Plan the Task with the user.",
    });
    await answered(planning.id, 2);
    const other = await threads.startOnTask({
      taskId: randomUUID(),
      roleKey,
      title: "Planning",
      opening: "Plan the Task with the user.",
    });
    await answered(other.id, 2);

    await runner.endWaiting(taskId);

    const [ended, kept] = engine.sessions;
    expect(ended?.received.at(-1)).toEqual({ step: "end" });
    expect(kept?.received.map(({ step }) => step)).not.toContain("end");
  });

  it("answers the user on a Task whatever the person's Chat is", async () => {
    await startWith(
      started(...aTurn("brief", "What must be true?"), sent("m-2"), ...aTurn("m-2", "Noted.")),
    );
    versions.push({ ...PLANNER, capabilities: { ...PLANNER.capabilities, chat: false } });
    const opened = await threads.startOnTask({
      taskId: randomUUID(),
      roleKey,
      title: "Planning",
      opening: "Plan the Task with the user.",
    });
    await answered(opened.id, 2);

    await runner.send(opened.id, "The page loads under a second.");
    const log = await answered(opened.id, 4);

    expect(drafts(log).slice(2)).toEqual([
      { kind: "user", text: "The page loads under a second.", delivery: "delivered" },
      { kind: "person", roleKey, text: "Noted." },
    ]);
  });

  it("refuses to open a Thread with a Role nobody fills", async () => {
    await startWith();

    await expect(
      threads.startOnTask({
        taskId: randomUUID(),
        roleKey: "nobody",
        title: "Planning",
        opening: "Plan the Task with the user.",
      }),
    ).rejects.toThrow(ThreadRefused);
    expect(engine.sessions).toHaveLength(0);
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

const EXPORT_QUESTION = "Should the export include archived Projects?";
const COLUMNS_QUESTION = "Which columns go into the export?";

/** The person opens a Decision with The Office's tool, which answers at once. */
function opensDecision(callId: string, question: string, options: string[]): Step[] {
  return [
    {
      step: "event",
      event: {
        kind: "tool-call",
        callId,
        tool: OPEN_DECISION_TOOL,
        officeTool: true,
        input: {
          question,
          context: "Archived Projects have no worktree.",
          options,
          recommended: 1,
          why: "It is what the export is for.",
        },
        withinToolCall: undefined,
      },
    },
    { step: "event", event: { kind: "tool-result", callId, text: "", isError: false } },
  ];
}

async function planningThread(): Promise<Thread> {
  return threads.startOnTask({
    taskId: randomUUID(),
    roleKey,
    title: "Planning",
    opening: "Plan the Task with the user.",
  });
}

/** The log without context lines and tool activity, whose order around a tool's own lines varies. */
function exchanges(log: readonly Message[]): MessageDraft[] {
  return drafts(log).filter(({ kind }) => kind !== "context" && kind !== "tool-activity");
}

describe("a Decision", () => {
  it("is opened by the person's tool, which returns at once, and waits on the user as a card in the Thread", async () => {
    await startWith(
      started(
        ...opensDecision("c-1", EXPORT_QUESTION, ["Only active Projects", "Every Project"]),
        ...aTurn("brief", "I asked about archived Projects."),
      ),
    );
    const opened = await planningThread();

    const log = await answered(opened.id, 4);

    const thread = await threads.read(opened.id);
    const decision = {
      id: expect.any(String),
      threadId: opened.id,
      taskId: opened.home.kind === "task" ? opened.home.taskId : "",
      roleKey,
      question: EXPORT_QUESTION,
      context: "Archived Projects have no worktree.",
      options: ["Only active Projects", "Every Project"],
      recommendation: { option: 0, reason: "It is what the export is for." },
      askedAt: expect.any(Date),
      passedOn: [],
      answer: undefined,
    };
    expect(thread.openDecision).toEqual(decision);
    expect(exchanges(log)).toEqual([
      { kind: "decision", roleKey, decisionId: thread.openDecision?.id },
      { kind: "person", roleKey, text: "I asked about archived Projects." },
    ]);
    await expect(decisions.listOpen()).resolves.toContainEqual(decision);
    await expect(decisions.openOn(thread.openDecision?.taskId ?? "")).resolves.toBe(1);
  });

  it("answered with an option goes into the running session with its question, and closes", async () => {
    await startWith(
      started(
        ...opensDecision("c-1", EXPORT_QUESTION, ["Only active Projects", "Every Project"]),
        ...aTurn("brief", "I asked."),
        sent("answer"),
        ...aTurn("answer", "Only active ones, then."),
      ),
    );
    const opened = await planningThread();
    await answered(opened.id, 4);
    const open = (await threads.read(opened.id)).openDecision;
    if (!open) throw new Error("No Decision was opened.");

    await decisions.answer(open.id, { kind: "option", option: 0 });
    const log = await answered(opened.id, 6);

    const [session] = engine.sessions;
    expect(engine.sessions).toHaveLength(1);
    const answer = session?.received.find((step) => step.step === "send");
    expect(answer?.step === "send" && answer.message.text).toBe(
      `The user answered your Decision "${EXPORT_QUESTION}" with the option "Only active Projects".`,
    );
    expect(drafts(log).slice(-2)).toEqual([
      { kind: "decision-answer", decisionId: open.id, answer: { kind: "option", option: 0 } },
      { kind: "person", roleKey, text: "Only active ones, then." },
    ]);
    const thread = await threads.read(opened.id);
    expect(thread.openDecision).toBeUndefined();
    await expect(decisions.listInThread(opened.id)).resolves.toEqual([
      { ...open, answer: { kind: "option", option: 0, answeredAt: expect.any(Date) } },
    ]);
    await expect(decisions.listOpen()).resolves.not.toContainEqual(
      expect.objectContaining({ id: open.id }),
    );
    await expect(decisions.openOn(open.taskId)).resolves.toBe(0);
    await expect(decisions.answer(open.id, { kind: "option", option: 1 })).rejects.toThrow(
      "This Decision is answered already.",
    );
  });

  it("takes a free answer after a follow-up, in a fresh session briefed with the Task's answered Decisions", async () => {
    await startWith(
      started(
        ...opensDecision("c-1", EXPORT_QUESTION, ["Only active Projects", "Every Project"]),
        ...aTurn("brief", "I asked."),
        sent("answer-1"),
        ...opensDecision("c-2", COLUMNS_QUESTION, ["Every column", "The visible ones"]),
        ...aTurn("answer-1", "One more."),
        sent("follow-up"),
        ...aTurn("follow-up", "The ones the table shows now."),
      ),
      started(...aTurn("brief", "Visible ones plus the id.")),
    );
    const opened = await planningThread();
    await answered(opened.id, 4);
    const first = (await threads.read(opened.id)).openDecision;
    if (!first) throw new Error("No Decision was opened.");
    await decisions.answer(first.id, { kind: "option", option: 0 });
    await answered(opened.id, 8);

    // A follow-up is an ordinary message: the Decision stays open.
    await runner.send(opened.id, "What does visible mean?");
    await answered(opened.id, 10);
    const second = (await threads.read(opened.id)).openDecision;
    expect(second?.question).toBe(COLUMNS_QUESTION);
    await cooled(opened.id, 80_000);

    await runner.answerDecision(opened.id, second?.id ?? "", {
      kind: "free-answer",
      text: "The visible ones, plus the id.",
    });
    const log = await answered(opened.id, 13);

    const fresh = engine.sessions[1];
    const brief = fresh?.received[0];
    const text = brief?.step === "start" ? brief.brief.text : "";
    // The Decision answered now is the message's, not the Brief's.
    expect(
      text.endsWith(
        `## Decisions the user answered\n\n- ${EXPORT_QUESTION}\n  Answer: Only active Projects\n\n## The user's message\n\nThe user answered your Decision "${COLUMNS_QUESTION}" in their own words:\n\nThe visible ones, plus the id.`,
      ),
    ).toBe(true);
    expect(text).not.toContain("## Your open Decision");
    expect(drafts(log).slice(-3)).toEqual([
      contextLine({
        move: "fresh",
        reason: "cache-expired",
        contextTokens: 80_000,
        briefTokens: expect.any(Number),
      }),
      {
        kind: "decision-answer",
        decisionId: second?.id,
        answer: { kind: "free-answer", text: "The visible ones, plus the id." },
      },
      { kind: "person", roleKey, text: "Visible ones plus the id." },
    ]);
  });

  it("waits on the user again when the session its answer goes to fails to start, and takes a new answer", async () => {
    await startWith(
      started(
        ...opensDecision("c-1", EXPORT_QUESTION, ["Only active Projects", "Every Project"]),
        ...aTurn("brief", "I asked."),
      ),
      // The engine lists a skill the session wasn't given, so the start check refuses it.
      [{ step: "start", brief: { id: "brief", text: "" }, listedSkills: ["stray"] }],
      started(...aTurn("brief", "Only active ones, then.")),
    );
    const opened = await planningThread();
    await answered(opened.id, 4);
    const open = (await threads.read(opened.id)).openDecision;
    if (!open) throw new Error("No Decision was opened.");
    const before = (await threads.read(opened.id)).session;
    await cooled(opened.id, 80_000);

    await decisions.answer(open.id, { kind: "option", option: 1 });
    const failed = await waiting(opened.id);

    expect(failed.openDecision).toEqual(open);
    expect(failed.session?.id).toBe(before?.id);
    await expect(decisions.listOpen()).resolves.toContainEqual(open);
    const log = drafts(await threads.messages(opened.id));
    expect(log.slice(-2)).toEqual([
      { kind: "decision-answer", decisionId: open.id, answer: { kind: "option", option: 1 } },
      { kind: "failure", reason: expect.stringContaining("stray") },
    ]);

    await decisions.answer(open.id, { kind: "option", option: 0 });
    await vi.waitFor(async () => {
      const thread = await threads.read(opened.id);
      if (thread.state !== "waiting" || thread.openDecision) throw new Error("Still answering.");
    });
    const brief = engine.sessions.at(-1)?.received[0];
    expect(brief?.step === "start" && brief.brief.text).toContain(
      `The user answered your Decision "${EXPORT_QUESTION}" with the option "Only active Projects".`,
    );
    expect(drafts(await threads.messages(opened.id)).at(-1)).toEqual({
      kind: "person",
      roleKey,
      text: "Only active ones, then.",
    });
  });

  it("is refused to a session no Thread on a Task has, with the reason the person reads", async () => {
    await startWith(started(...aTurn("brief", "Hello.")));
    const chat = await threads.startInChat(roleKey);
    await runner.send(chat.id, "Hello.");
    await answered(chat.id, 3);
    const chatSession = (await threads.read(chat.id)).session?.id ?? "";
    const [tool] = app.get(OfficeToolRegistry).named([OPEN_DECISION_TOOL]);
    const input = {
      question: EXPORT_QUESTION,
      context: "",
      options: ["Only active Projects", "Every Project"],
      recommended: 1,
      why: "It is what the export is for.",
    };

    await expect(tool?.run(input, { sessionId: chatSession })).resolves.toEqual({
      text: "A Decision is opened on a Task. In your chat, ask the user in your answer instead.",
      isError: true,
    });
    await expect(tool?.run(input, { sessionId: randomUUID() })).resolves.toEqual({
      text: "The Office doesn't know this session's Thread.",
      isError: true,
    });
  });
});

describe("a message mentioning records", () => {
  it("briefs a new session with each record, read now, and logs the message as written", async () => {
    await startWith(
      started(
        ...opensDecision("c-1", EXPORT_QUESTION, ["Only active Projects", "Every Project"]),
        ...aTurn("brief", "I asked."),
      ),
      started(...aTurn("brief", "I read them.")),
    );
    const planning = await planningThread();
    await answered(planning.id, 4);
    const decision = (await threads.read(planning.id)).openDecision;
    if (!decision) throw new Error("No Decision was opened.");
    const taskId = randomUUID();
    const ideaId = randomUUID();
    const missingTaskId = randomUUID();
    workRecords.set(taskId, "Export CSV (Task) · Plan: write the exporter.");
    workRecords.set(ideaId, "Dark mode (Idea) · Notes: for the night shift.");
    workRecords.set(decision.taskId, "Admin export (Task) · Plan: ask about archived Projects.");
    const chat = await threads.startInChat(roleKey);
    const said = "Compare [@Export CSV](/tasks/x) with [@Dark mode](/work/ideas?idea=y).";

    await runner.send(chat.id, said, [
      { kind: "task", taskId },
      { kind: "idea", ideaId },
      { kind: "decision", decisionId: decision.id },
      { kind: "task", taskId: missingTaskId },
    ]);
    const log = await answered(chat.id, 3);

    const brief = engine.sessions[1]?.received[0];
    const text = brief?.step === "start" ? brief.brief.text : "";
    expect(text).toMatch(
      /\n\n## Records the user mentioned\n\n[\s\S]+\n\n## The user's message\n\n/,
    );
    expect(text.endsWith(`## The user's message\n\n${said}`)).toBe(true);
    const records = text
      .slice(
        text.indexOf("## Records the user mentioned\n\n") + 31,
        text.indexOf("\n\n## The user's message"),
      )
      .split("\n\n---\n\n");
    expect(records).toHaveLength(4);
    expect(records[0]).toBe("Export CSV (Task) · Plan: write the exporter.");
    expect(records[1]).toBe("Dark mode (Idea) · Notes: for the night shift.");
    expect(records[2]).toContain(`Question: ${EXPORT_QUESTION}`);
    expect(records[2]).toContain("Not answered yet: it waits on the user.");
    expect(records[2]).toContain("Admin export (Task) · Plan: ask about archived Projects.");
    expect(records[3]).toBe(`The Office has no Task ${missingTaskId}.`);
    // The Thread's context line shows the Brief with the records, as the session got it.
    const [context, message] = drafts(log);
    expect(context?.kind === "context" && context.brief).toContain("## Records the user mentioned");
    expect(message).toEqual({ kind: "user", text: said, delivery: "delivered" });
  });

  it("gives a running session the records with the next message", async () => {
    await startWith(started(...aTurn("brief", "Hello."), sent("m-2"), ...aTurn("m-2", "Read it.")));
    const taskId = randomUUID();
    workRecords.set(taskId, "Export CSV (Task) · Plan: write the exporter.");
    const chat = await threads.startInChat(roleKey);
    await runner.send(chat.id, "Hello.");
    await answered(chat.id, 3);

    await runner.send(chat.id, "Look at [@Export CSV](/tasks/x).", [{ kind: "task", taskId }]);
    const log = await answered(chat.id, 5);

    expect(engine.sessions).toHaveLength(1);
    const next = engine.sessions[0]?.received.find((step) => step.step === "send");
    expect(next?.step === "send" && next.message.text).toBe(
      "Look at [@Export CSV](/tasks/x).\n\n## Records the user mentioned\n\nExport CSV (Task) · Plan: write the exporter.",
    );
    expect(drafts(log)[3]).toEqual({
      kind: "user",
      text: "Look at [@Export CSV](/tasks/x).",
      delivery: "delivered",
    });
  });
});

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
