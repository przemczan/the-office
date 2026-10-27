import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import {
  decisionListSchema,
  messageListSchema,
  sizeThresholdSchema,
  threadListSchema,
  threadRefusalSchema,
  threadSchema,
  threadWebEventSchema,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { ScriptedEngine, ScriptedEngineModule } from "../../../engine/index.js";
import { RoleCards, type SessionRole } from "../../../people/index.js";
import { SkillsModule } from "../../../skills/index.js";
import { Briefs } from "../../application/briefs.js";
import { DecisionService } from "../../application/decision-service.js";
import { aPlannerCard } from "../../application/session-role.fixtures.js";
import { SessionPlaces } from "../../application/session-places.js";
import { TaskThreadSetups } from "../../application/task-thread-setups.js";
import { ThreadContexts } from "../../application/thread-contexts.js";
import { StageThreads } from "../../application/stage-threads.js";
import { ThreadRunner } from "../../application/thread-runner.js";
import { ThreadService } from "../../application/thread-service.js";
import { DecisionAnswered } from "../../domain/conversation-events.js";
import type { Decision } from "../../domain/decision.js";
import type { Thread } from "../../domain/thread.js";
import { aThread } from "../../domain/thread.fixtures.js";
import { ProjectBases } from "../../ports/project-bases.js";
import { ThreadRepository } from "../../ports/thread-repository.js";
import { PostgresThreadRepository } from "../postgres/postgres-thread-repository.js";
import { ThreadWebEvents } from "../websocket/thread-web-events.js";
import { DecisionsController } from "./decisions.controller.js";
import { SizeThresholdController } from "./size-threshold.controller.js";
import { ThreadsController } from "./threads.controller.js";
import { ContextPolicySettingsService } from "../../application/context-policy-settings.js";
import { ConversationsSettings } from "../../ports/conversations-settings.js";
import { ConversationsSettingsForTests } from "../../ports/conversations-settings.fixtures.js";

let app: INestApplication;
let url: string;
let officeData: string;
let published: DomainEvent[];
/** The people the chats are with, by Role key: each test hires its own. */
let people: Map<string, SessionRole>;

beforeEach(async () => {
  people = new Map();
  officeData = await mkdtemp(join(tmpdir(), "office-threads-http-"));
  const roleCards: Pick<RoleCards, "find" | "forResumedSession"> = {
    find: (roleKey) => Promise.resolve(people.get(roleKey)),
    forResumedSession: (roleKey) => {
      const person = people.get(roleKey);
      return person ? Promise.resolve(person) : Promise.reject(new Error(`No ${roleKey} here.`));
    },
  };
  const bases: ProjectBases = {
    folder: join(officeData, "bases"),
    list: () => Promise.resolve([]),
    refresh: () => Promise.resolve([]),
  };
  ({ app, url } = await startTestApplication({
    database: true,
    imports: [
      EventsModule,
      EventStreamModule,
      TelemetryModule,
      OfficeDataModule.forRoot(officeData),
      SkillsModule,
      // The runner's own tests answer messages; these send ones it refuses, or no session takes.
      ScriptedEngineModule.register(new ScriptedEngine([])),
    ],
    controllers: [ThreadsController, DecisionsController, SizeThresholdController],
    providers: [
      { provide: ThreadRepository, useClass: PostgresThreadRepository },
      { provide: RoleCards, useValue: roleCards },
      { provide: ProjectBases, useValue: bases },
      { provide: ConversationsSettings, useValue: new ConversationsSettingsForTests() },
      ContextPolicySettingsService,
      ThreadService,
      Briefs,
      TaskThreadSetups,
      SessionPlaces,
      ThreadContexts,
      ThreadRunner,
      StageThreads,
      DecisionService,
      ThreadWebEvents,
    ],
  }));
  app.get(TaskThreadSetups).provide({
    setUp: ({ taskId }) =>
      Promise.resolve({
        folder: join(officeData, "worktrees", taskId),
        environment: {},
        useProjectSkills: false,
        instructions: "On this Task you plan.",
        officeTools: [],
        brief: "The Task's record.",
      }),
  });
  published = [];
  app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
});

afterEach(async () => {
  await app.close();
  await rm(officeData, { recursive: true, force: true });
});

/** A person of this test's own, with Chat on or off. */
function aPerson(name: string, chat: boolean): string {
  const roleKey = `role-${randomUUID()}`;
  const card = aPlannerCard({
    name,
    capabilities: { sharedMemory: false, chat, consultant: true },
  });
  people.set(roleKey, { roleKey, cardVersion: 1, card });
  return roleKey;
}

/** The events published so far, as the web receives them. */
function webEvents(): unknown[] {
  const forwarding = app.get(WebEventForwarding);
  return published.map((event) => {
    const { occurredAt: _occurredAt, ...webEvent } = threadWebEventSchema.parse(
      forwarding.toWebEvent(event),
    );
    return webEvent;
  });
}

function send(method: "POST" | "PUT", path: string, body?: unknown): Promise<Response> {
  return fetch(`${url}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function get(path: string): Promise<Response> {
  return fetch(`${url}/api${path}`);
}

describe("a person's chat", () => {
  it("starts fresh Threads, lists them newest first and reads each", async () => {
    const roleKey = aPerson("Jan", true);

    const first = threadSchema.parse(
      await (await send("POST", `/chats/${roleKey}/threads`)).json(),
    );
    const second = threadSchema.parse(
      await (await send("POST", `/chats/${roleKey}/threads`)).json(),
    );

    expect(first).toMatchObject({
      home: { kind: "chat", roleKey },
      roleKey,
      title: null,
      state: "waiting",
      tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      context: {
        move: "fresh",
        reason: "new-thread",
        cacheWarm: false,
        contextTokens: 0,
        briefTokens: expect.any(Number),
        alternatives: [],
        override: null,
      },
    });
    const listed = threadListSchema.parse(await (await get(`/chats/${roleKey}/threads`)).json());
    expect(listed.map(({ id }) => id)).toEqual([second.id, first.id]);
    expect(threadSchema.parse(await (await get(`/threads/${first.id}`)).json())).toEqual(first);
    expect(
      messageListSchema.parse(await (await get(`/threads/${first.id}/messages`)).json()),
    ).toEqual([]);
    expect(webEvents()).toEqual([
      { type: "thread.started", threadId: first.id, home: { kind: "chat", roleKey } },
      { type: "thread.started", threadId: second.id, home: { kind: "chat", roleKey } },
    ]);
  });

  it("refuses a Thread with a person whose Chat is off, and a chat with nobody", async () => {
    const roleKey = aPerson("Ada", false);

    const refused = await send("POST", `/chats/${roleKey}/threads`);
    const nobody = await send("POST", `/chats/role-${randomUUID()}/threads`);

    expect(refused.status).toBe(422);
    expect(threadRefusalSchema.parse(await refused.json()).reasons).toEqual([
      "Chat is off for Ada: talk to them on a Task, or turn Chat on on their Role card.",
    ]);
    expect(nobody.status).toBe(404);
    expect(published).toEqual([]);
  });
});

describe("a Task's conversation", () => {
  it("lists the Threads on the Task, the newest first, and none on another", async () => {
    const taskId = randomUUID();
    const repository = app.get(ThreadRepository);
    const home = { kind: "task", taskId } as const;
    const older = aThread({
      id: randomUUID(),
      home,
      startedAt: new Date("2026-10-25T09:00:00.000Z"),
    });
    const newer = aThread({
      id: randomUUID(),
      home,
      startedAt: new Date("2026-10-25T10:00:00.000Z"),
    });
    await repository.add(older);
    await repository.add(newer);

    const listed = await get(`/tasks/${taskId}/threads`);
    const elsewhere = await get(`/tasks/${randomUUID()}/threads`);

    expect(threadListSchema.parse(await listed.json()).map(({ id }) => id)).toEqual([
      newer.id,
      older.id,
    ]);
    expect(threadListSchema.parse(await elsewhere.json())).toEqual([]);
  });

  it("lists a person's Threads on every Task, for their Work tab", async () => {
    const roleKey = aPerson("Jan", false);
    const repository = app.get(ThreadRepository);
    const planning = aThread({
      id: randomUUID(),
      home: { kind: "task", taskId: randomUUID() },
      roleKey,
      title: "Planning",
    });
    await repository.add(planning);
    await repository.add(aThread({ id: randomUUID(), home: { kind: "chat", roleKey }, roleKey }));

    const listed = await get(`/roles/${roleKey}/task-threads`);

    expect(listed.status).toBe(200);
    expect(threadListSchema.parse(await listed.json())).toEqual([
      expect.objectContaining({ id: planning.id, home: planning.home, title: "Planning" }),
    ]);
  });
});

describe("a Thread", () => {
  it("is renamed, and a title it refuses names the reason", async () => {
    const roleKey = aPerson("Jan", true);
    const thread = threadSchema.parse(
      await (await send("POST", `/chats/${roleKey}/threads`)).json(),
    );

    const renamed = await send("PUT", `/threads/${thread.id}/title`, { title: "  Deploys " });
    const refused = await send("PUT", `/threads/${thread.id}/title`, { title: "" });

    expect(threadSchema.parse(await renamed.json()).title).toBe("Deploys");
    expect(refused.status).toBe(422);
    expect(threadRefusalSchema.parse(await refused.json()).reasons).toEqual([
      "Give the Thread a title.",
    ]);
    expect(webEvents()).toContainEqual({
      type: "thread.renamed",
      threadId: thread.id,
      home: { kind: "chat", roleKey },
    });
  });

  it("answers its log in order, as the web reads it", async () => {
    const roleKey = aPerson("Jan", true);
    const thread = threadSchema.parse(
      await (await send("POST", `/chats/${roleKey}/threads`)).json(),
    );
    const service = app.get(ThreadService);

    await service.log(thread.id, [
      { kind: "user", text: "Read the deploy workflow.", delivery: "delivered" },
      { kind: "tool-activity", roleKey, tool: "Read", summary: "deploy-production.yml" },
      { kind: "refusal", roleKey, tool: "Edit", reason: "A chat only reads." },
      { kind: "person", roleKey, text: "It deploys on every push to main." },
    ]);

    const messages = messageListSchema.parse(
      await (await get(`/threads/${thread.id}/messages`)).json(),
    );
    expect(messages.map(({ id: _id, at: _at, ...message }) => message)).toEqual([
      { kind: "user", text: "Read the deploy workflow.", delivery: "delivered" },
      { kind: "tool-activity", roleKey, tool: "Read", summary: "deploy-production.yml" },
      { kind: "refusal", roleKey, tool: "Edit", reason: "A chat only reads." },
      { kind: "person", roleKey, text: "It deploys on every push to main." },
    ]);
    const titled = threadSchema.parse(await (await get(`/threads/${thread.id}`)).json());
    expect(titled.title).toBe("Read the deploy workflow");
    expect(webEvents()).toContainEqual({
      type: "thread.messages-logged",
      threadId: thread.id,
      home: { kind: "chat", roleKey },
    });
  });

  it("takes Start fresh or Continue anyway for the next message, and back to the policy", async () => {
    const roleKey = aPerson("Jan", true);
    const thread = threadSchema.parse(
      await (await send("POST", `/chats/${roleKey}/threads`)).json(),
    );

    const chosen = await send("PUT", `/threads/${thread.id}/context-override`, {
      override: "start-fresh",
    });
    const cleared = await send("PUT", `/threads/${thread.id}/context-override`, { override: null });

    expect(threadSchema.parse(await chosen.json()).context.override).toBe("start-fresh");
    expect(threadSchema.parse(await cleared.json()).context.override).toBeNull();
    expect(webEvents()).toContainEqual({
      type: "thread.override-chosen",
      threadId: thread.id,
      home: { kind: "chat", roleKey },
    });
  });

  it("refuses an empty message, and one to a person whose Chat is now off", async () => {
    const roleKey = aPerson("Jan", true);
    const thread = threadSchema.parse(
      await (await send("POST", `/chats/${roleKey}/threads`)).json(),
    );

    const empty = await send("POST", `/threads/${thread.id}/messages`, { text: "  " });
    people.set(roleKey, {
      roleKey,
      cardVersion: 2,
      card: aPlannerCard({ capabilities: { sharedMemory: false, chat: false, consultant: true } }),
    });
    const chatOff = await send("POST", `/threads/${thread.id}/messages`, { text: "Hello." });

    expect(empty.status).toBe(422);
    expect(threadRefusalSchema.parse(await empty.json()).reasons).toEqual([
      "Write a message first.",
    ]);
    expect(chatOff.status).toBe(422);
    expect(threadRefusalSchema.parse(await chatOff.json()).reasons[0]).toMatch(
      /^Chat is off for Jan/,
    );
  });

  it("is not found when it isn't there", async () => {
    const response = await get(`/threads/${randomUUID()}`);

    expect(response.status).toBe(404);
  });
});

describe("a Decision", () => {
  const draft = {
    question: "Should the export include archived Projects?",
    context: "Archived Projects have no worktree.",
    options: ["Only active Projects", "Every Project"],
    recommendation: { option: 0, reason: "Archived ones have nothing to export." },
  };

  /** A planning Thread on a Task of its own whose session opened a Decision. */
  async function opened(): Promise<{ readonly thread: Thread; readonly decision: Decision }> {
    const roleKey = aPerson("Jan", false);
    const sessionId = randomUUID();
    const thread = aThread({
      id: randomUUID(),
      home: { kind: "task", taskId: randomUUID() },
      roleKey,
      title: "Planning",
      session: {
        id: sessionId,
        roleKey,
        cardVersion: 1,
        startedAt: new Date(),
        lastCallAt: new Date(),
        contextTokens: 34_000,
        startContextTokens: 33_000,
        full: false,
      },
    });
    await app.get(ThreadRepository).add(thread);
    const decision = await app.get(DecisionService).open(sessionId, draft);
    return { thread, decision };
  }

  it("shows in the Thread's log as its card, and among the open Decisions, as the web reads them", async () => {
    const { thread, decision } = await opened();

    const open = decisionListSchema.parse(await (await get("/decisions/open")).json());
    const messages = messageListSchema.parse(
      await (await get(`/threads/${thread.id}/messages`)).json(),
    );

    const shown = {
      ...draft,
      id: decision.id,
      threadId: thread.id,
      taskId: decision.taskId,
      roleKey: thread.roleKey,
      askedAt: decision.askedAt.toISOString(),
      answer: null,
      answeredAt: null,
    };
    expect(open).toContainEqual(shown);
    expect(messages.map(({ id: _id, at: _at, ...message }) => message)).toEqual([
      { kind: "decision", roleKey: thread.roleKey, decision: shown },
    ]);
    expect(webEvents()).toContainEqual({
      type: "thread.decision-opened",
      threadId: thread.id,
      home: thread.home,
      decisionId: decision.id,
    });
  });

  it("refuses an answer that isn't one of its options, or isn't an answer, and is not found when it isn't there", async () => {
    const { decision } = await opened();

    const wrongOption = await send("POST", `/decisions/${decision.id}/answer`, {
      kind: "option",
      option: 2,
    });
    const noAnswer = await send("POST", `/decisions/${decision.id}/answer`, { kind: "maybe" });
    const nowhere = await send("POST", `/decisions/${randomUUID()}/answer`, {
      kind: "free-answer",
      text: "Yes.",
    });

    expect(wrongOption.status).toBe(422);
    expect(threadRefusalSchema.parse(await wrongOption.json()).reasons).toEqual([
      "Choose one of the Decision's options.",
    ]);
    expect(noAnswer.status).toBe(400);
    expect(nowhere.status).toBe(404);
  });

  it("opens again when the session its answer goes to fails to start, keeping the answer in the log", async () => {
    // The scripted engine has no script: resuming the Decision's session fails.
    const { thread, decision } = await opened();

    const response = await send("POST", `/decisions/${decision.id}/answer`, {
      kind: "free-answer",
      text: "Only this year's.",
    });
    const open = await vi.waitFor(
      async () => {
        const decisions = decisionListSchema.parse(await (await get("/decisions/open")).json());
        if (!decisions.some(({ id }) => id === decision.id)) throw new Error("Still answered.");
        return decisions;
      },
      { timeout: 5_000, interval: 20 },
    );
    const messages = messageListSchema.parse(
      await (await get(`/threads/${thread.id}/messages`)).json(),
    );

    expect(response.status).toBe(202);
    expect(open.find(({ id }) => id === decision.id)).toMatchObject({ answer: null });
    expect(messages.map((message) => message.kind)).toEqual([
      "decision",
      "decision-answer",
      "failure",
    ]);
    expect(messages[1]).toMatchObject({
      answer: { kind: "free-answer", text: "Only this year's." },
      decision: { answer: null },
    });
    expect(webEvents()).toContainEqual({
      type: "thread.decision-reopened",
      threadId: thread.id,
      home: thread.home,
      decisionId: decision.id,
    });
  });

  it("refuses a second answer, and shows the first in the log", async () => {
    const { thread, decision } = await opened();
    const answered: Decision = {
      ...decision,
      answer: { kind: "free-answer", text: "Only this year's.", answeredAt: new Date() },
    };
    await app.get(ThreadRepository).update(thread.id, (current) => {
      const waiting = { ...current, openDecision: undefined };
      const line = {
        kind: "decision-answer",
        id: randomUUID(),
        threadId: thread.id,
        at: new Date(),
        decisionId: decision.id,
        answer: { kind: "free-answer", text: "Only this year's." },
      } as const;
      return {
        thread: waiting,
        logged: [line],
        decision: answered,
        event: new DecisionAnswered(waiting, answered, new Date()),
      };
    });

    const again = await send("POST", `/decisions/${decision.id}/answer`, {
      kind: "option",
      option: 0,
    });
    const messages = messageListSchema.parse(
      await (await get(`/threads/${thread.id}/messages`)).json(),
    );

    expect(again.status).toBe(422);
    expect(threadRefusalSchema.parse(await again.json()).reasons).toEqual([
      "This Decision is answered already.",
    ]);
    expect(messages.map((message) => message.kind)).toEqual(["decision", "decision-answer"]);
    expect(messages[1]).toMatchObject({
      answer: { kind: "free-answer", text: "Only this year's." },
      decision: { answer: { kind: "free-answer", text: "Only this year's." } },
    });
    const open = decisionListSchema.parse(await (await get("/decisions/open")).json());
    expect(open.map(({ id }) => id)).not.toContain(decision.id);
  });
});

describe("/api/settings/size-threshold", () => {
  it("keeps a new size threshold for the next continuation and announces it", async () => {
    const changed = await send("PUT", "/settings/size-threshold", { sizeThreshold: 50_000 });

    expect(changed.status).toBe(200);
    expect(sizeThresholdSchema.parse(await (await get("/settings/size-threshold")).json())).toEqual(
      { sizeThreshold: 50_000 },
    );
    await expect(app.get(ContextPolicySettingsService).current()).resolves.toMatchObject({
      sizeThreshold: 50_000,
    });
    expect(webEvents()).toEqual([{ type: "context-policy.size-threshold-changed" }]);
  });

  it.each([0, 12_345, 1_000_000])("refuses %s tokens", async (sizeThreshold) => {
    const refused = await send("PUT", "/settings/size-threshold", { sizeThreshold });

    expect(refused.status).toBe(400);
    expect(published).toEqual([]);
  });
});
