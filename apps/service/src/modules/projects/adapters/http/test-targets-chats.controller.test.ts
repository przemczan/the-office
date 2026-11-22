import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { projectTestTargetsChatSchema, type ProjectTestTargetsChat } from "@the-office/contracts";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { SIGNED_IN_FOR_TESTS } from "../../../../platform/http/signed-in-requests.fixtures.js";
import { ProjectService } from "../../application/project-service.js";
import {
  TestTargetsChatThreads,
  type TestTargetsChatThreadSource,
  type TestTargetsChatThreadStart,
} from "../../application/test-targets-chat-threads.js";
import { TestTargetsChats } from "../../application/test-targets-chats.js";
import {
  TestTargetsSetUpTasks,
  type TestTargetsSetUpTask,
} from "../../application/test-targets-set-up-tasks.js";
import { aProject } from "../../domain/project.fixtures.js";
import { ProjectNotFound } from "../../domain/project-not-found.js";
import type { TestTargetsChatThread } from "../../domain/test-targets-chat.js";
import { TestTargetsChatAsked } from "../../domain/test-targets-chat-events.js";
import { TestTargetsChatRepository } from "../../ports/test-targets-chat-repository.js";
import { PostgresProjectRepository } from "../postgres/postgres-project-repository.js";
import { PostgresTestTargetsChatRepository } from "../postgres/postgres-test-targets-chat-repository.js";
import { testTargetsChats } from "../postgres/test-targets-chats.schema.js";
import { TestTargetsChatsController } from "./test-targets-chats.controller.js";

/** Conversations stood in for: whoever onboards Projects, and each Thread it started. */
class ChatThreadsForTests implements TestTargetsChatThreadSource {
  holder: string | undefined = "devops";
  refusal: readonly string[] | undefined;
  readonly titles = new Map<string, string>();
  readonly threads = new Map<string, TestTargetsChatThread>();

  async start(title: string): Promise<TestTargetsChatThreadStart> {
    if (this.holder === undefined) return { kind: "nobody" };
    if (this.refusal) return { kind: "refused", reasons: this.refusal };
    const threadId = randomUUID();
    this.titles.set(threadId, title);
    this.threads.set(threadId, {
      answering: false,
      lastUserMessageAt: undefined,
      lastMessageAt: undefined,
      proposals: [],
    });
    return { kind: "started", threadId, roleKey: this.holder };
  }

  async read(threadId: string): Promise<TestTargetsChatThread | undefined> {
    return this.threads.get(threadId);
  }
}

let app: INestApplication;
let url: string;
let threads: ChatThreadsForTests;
let setUpTask: TestTargetsSetUpTask | undefined;
let published: DomainEvent[];

beforeAll(async () => {
  ({ app, url } = await startTestApplication({
    database: true,
    imports: [EventsModule],
    controllers: [TestTargetsChatsController],
    providers: [
      PostgresProjectRepository,
      {
        provide: ProjectService,
        inject: [PostgresProjectRepository],
        useFactory: (projects: PostgresProjectRepository) => ({
          read: async (id: string) => {
            const project = await projects.find(id);
            if (!project) throw new ProjectNotFound(id);
            return project;
          },
        }),
      },
      { provide: TestTargetsChatRepository, useClass: PostgresTestTargetsChatRepository },
      TestTargetsChatThreads,
      TestTargetsSetUpTasks,
      TestTargetsChats,
    ],
  }));
  app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
  app.get(TestTargetsSetUpTasks).register(async () => setUpTask);
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  threads = new ChatThreadsForTests();
  app.get(TestTargetsChatThreads).register(threads);
  setUpTask = undefined;
  published = [];
});

/** A Project of the test's own, since every test file shares the database. */
async function aStoredProject(): Promise<string> {
  const id = `project-${randomUUID()}`;
  await app.get(PostgresProjectRepository).add(aProject({ id, name: "Billing" }));
  return id;
}

function send(method: "GET" | "POST", projectId: string): Promise<Response> {
  return fetch(`${url}/api/projects/${projectId}/test-targets/chat`, { method });
}

async function chatOf(projectId: string): Promise<ProjectTestTargetsChat> {
  const response = await send("GET", projectId);
  expect(response.status).toBe(200);
  return projectTestTargetsChatSchema.parse(await response.json());
}

async function ask(projectId: string): Promise<ProjectTestTargetsChat> {
  const response = await send("POST", projectId);
  expect(response.status).toBe(200);
  return projectTestTargetsChatSchema.parse(await response.json());
}

describe("POST /projects/:id/test-targets/chat", () => {
  it("starts a titled chat Thread with whoever onboards Projects, kept as asked by you, a draft", async () => {
    const projectId = await aStoredProject();

    const { chat, setUpTask: none } = await ask(projectId);

    expect(none).toBeNull();
    expect(chat).toEqual({
      threadId: expect.any(String),
      roleKey: "devops",
      state: "draft",
      since: expect.any(String),
    });
    expect(threads.titles.get(chat?.threadId ?? "")).toBe("Set up test targets: Billing");
    const [row] = await app
      .get<Database>(DATABASE)
      .select()
      .from(testTargetsChats)
      .where(eq(testTargetsChats.projectId, projectId));
    expect(row).toEqual({
      threadId: chat?.threadId,
      projectId,
      roleKey: "devops",
      askedBy: { userId: SIGNED_IN_FOR_TESTS.userId, name: SIGNED_IN_FOR_TESTS.name },
      askedAt: new Date(chat?.since ?? ""),
    });
    expect(published).toEqual([expect.any(TestTargetsChatAsked)]);
  });

  it("asks again in a new Thread, which the card follows, while no Proposal is open", async () => {
    const projectId = await aStoredProject();
    const first = (await ask(projectId)).chat;
    threads.threads.set(first?.threadId ?? "", {
      answering: false,
      lastUserMessageAt: new Date(),
      lastMessageAt: new Date(),
      proposals: [],
    });

    const again = (await ask(projectId)).chat;

    expect(again?.threadId).not.toBe(first?.threadId);
    expect((await chatOf(projectId)).chat).toEqual(again);
  });

  it("refuses while the followed chat's Proposal is open, starting nothing", async () => {
    const projectId = await aStoredProject();
    const first = (await ask(projectId)).chat;
    threads.threads.set(first?.threadId ?? "", {
      answering: false,
      lastUserMessageAt: new Date(),
      lastMessageAt: new Date(),
      proposals: [{ open: true, draftedAt: new Date() }],
    });

    const response = await send("POST", projectId);

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      reasons: ["The test targets Proposal in the chat is still open: apply or dismiss it first."],
    });
    expect(threads.titles.size).toBe(1);
  });

  it("refuses while nobody onboards Projects, keeping nothing", async () => {
    const projectId = await aStoredProject();
    threads.holder = undefined;

    const response = await send("POST", projectId);

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      message:
        "Nobody onboards Projects yet: give Onboards and repairs Projects to someone in People.",
    });
    expect((await chatOf(projectId)).chat).toBeNull();
    expect(published).toEqual([]);
  });

  it("says why Conversations refused the chat, such as the person's Chat being off", async () => {
    const projectId = await aStoredProject();
    threads.refusal = [
      "Chat is off for Nina: talk to them on a Task, or turn Chat on on their Role card.",
    ];

    const response = await send("POST", projectId);

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ reasons: threads.refusal });
  });

  it("answers 404 for a Project that doesn't exist", async () => {
    expect((await send("POST", `project-${randomUUID()}`)).status).toBe(404);
  });
});

describe("GET /projects/:id/test-targets/chat", () => {
  it("answers no chat while none was asked, with an open set-up Task made before", async () => {
    const projectId = await aStoredProject();
    setUpTask = { id: "task-1", title: "Set up test targets", state: "in-progress" };

    expect(await chatOf(projectId)).toEqual({
      chat: null,
      setUpTask: { id: "task-1", title: "Set up test targets", state: "in-progress" },
    });
  });

  it("follows the chat's state from its Thread, and ends it once its Proposal is applied or dismissed", async () => {
    const projectId = await aStoredProject();
    const threadId = (await ask(projectId)).chat?.threadId ?? "";
    const wroteAt = new Date("2026-11-22T10:01:00.000Z");
    const repliedAt = new Date("2026-11-22T10:03:00.000Z");
    const draftedAt = new Date("2026-11-22T10:04:00.000Z");

    threads.threads.set(threadId, {
      answering: true,
      lastUserMessageAt: wroteAt,
      lastMessageAt: wroteAt,
      proposals: [],
    });
    expect((await chatOf(projectId)).chat).toMatchObject({
      state: "answering",
      since: wroteAt.toISOString(),
    });

    threads.threads.set(threadId, {
      answering: false,
      lastUserMessageAt: wroteAt,
      lastMessageAt: repliedAt,
      proposals: [],
    });
    expect((await chatOf(projectId)).chat).toMatchObject({
      state: "waiting-on-you",
      since: repliedAt.toISOString(),
    });

    threads.threads.set(threadId, {
      answering: false,
      lastUserMessageAt: wroteAt,
      lastMessageAt: draftedAt,
      proposals: [{ open: true, draftedAt }],
    });
    expect((await chatOf(projectId)).chat).toEqual({
      threadId,
      roleKey: "devops",
      state: "proposal",
      since: draftedAt.toISOString(),
    });

    threads.threads.set(threadId, {
      answering: false,
      lastUserMessageAt: wroteAt,
      lastMessageAt: draftedAt,
      proposals: [{ open: false, draftedAt }],
    });
    expect(await chatOf(projectId)).toEqual({ chat: null, setUpTask: null });
  });

  it("answers 404 for a Project that doesn't exist", async () => {
    expect((await send("GET", `project-${randomUUID()}`)).status).toBe(404);
  });
});
