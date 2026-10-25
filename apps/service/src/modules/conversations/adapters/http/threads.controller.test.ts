import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import {
  messageListSchema,
  threadListSchema,
  threadRefusalSchema,
  threadSchema,
  threadWebEventSchema,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
import { aPlannerCard } from "../../application/session-role.fixtures.js";
import { CONTEXT_POLICY_SETTINGS, ThreadContexts } from "../../application/thread-contexts.js";
import { ThreadRunner } from "../../application/thread-runner.js";
import { ThreadService } from "../../application/thread-service.js";
import { DEFAULT_CONTEXT_POLICY_SETTINGS } from "../../domain/context-policy.js";
import { ProjectBases } from "../../ports/project-bases.js";
import { ThreadRepository } from "../../ports/thread-repository.js";
import { PostgresThreadRepository } from "../postgres/postgres-thread-repository.js";
import { ThreadWebEvents } from "../websocket/thread-web-events.js";
import { ThreadsController } from "./threads.controller.js";

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
    forResumedSession: (roleKey) => Promise.reject(new Error(`${roleKey} isn't resumed here.`)),
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
      // The runner's own tests answer messages; these send only ones it refuses.
      ScriptedEngineModule.register(new ScriptedEngine([])),
    ],
    controllers: [ThreadsController],
    providers: [
      { provide: ThreadRepository, useClass: PostgresThreadRepository },
      { provide: RoleCards, useValue: roleCards },
      { provide: ProjectBases, useValue: bases },
      { provide: CONTEXT_POLICY_SETTINGS, useValue: DEFAULT_CONTEXT_POLICY_SETTINGS },
      ThreadService,
      Briefs,
      ThreadContexts,
      ThreadRunner,
      ThreadWebEvents,
    ],
  }));
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
      { kind: "user", text: "Read the deploy workflow." },
      { kind: "tool-activity", roleKey, tool: "Read", summary: "deploy-production.yml" },
      { kind: "refusal", roleKey, tool: "Edit", reason: "A chat only reads." },
      { kind: "person", roleKey, text: "It deploys on every push to main." },
    ]);

    const messages = messageListSchema.parse(
      await (await get(`/threads/${thread.id}/messages`)).json(),
    );
    expect(messages.map(({ id: _id, at: _at, ...message }) => message)).toEqual([
      { kind: "user", text: "Read the deploy workflow." },
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
