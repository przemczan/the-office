import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import type { Message } from "../../domain/message.js";
import type { Thread } from "../../domain/thread.js";
import { logMessages, openDecision, renameThread } from "../../domain/thread-changes.js";
import { aThread, aUserMessage } from "../../domain/thread.fixtures.js";
import { ThreadNotFound } from "../../domain/thread-not-found.js";
import { PostgresThreadRepository } from "./postgres-thread-repository.js";

let app: INestApplication;
let repository: PostgresThreadRepository;

beforeAll(async () => {
  ({ app } = await startTestApplication({
    database: true,
    providers: [PostgresThreadRepository],
  }));
  repository = app.get(PostgresThreadRepository);
});

afterAll(async () => {
  await app.close();
});

/** A Thread in a chat of this test's own: every test file shares the database. */
function aThreadOfItsOwn(roleKey: string, fields: Partial<Thread> = {}): Thread {
  return aThread({ id: randomUUID(), home: { kind: "chat", roleKey }, roleKey, ...fields });
}

const AT = new Date("2026-10-25T10:00:00.000Z");

describe("PostgresThreadRepository", () => {
  it("keeps a Thread with its session and tokens, and lists a home's newest first", async () => {
    const roleKey = `role-${randomUUID()}`;
    const older = aThreadOfItsOwn(roleKey, { startedAt: new Date("2026-10-25T09:00:00.000Z") });
    const newer = aThreadOfItsOwn(roleKey, {
      startedAt: new Date("2026-10-25T09:30:00.000Z"),
      title: "Deploys",
      state: "answering",
      session: {
        id: randomUUID(),
        roleKey,
        cardVersion: 2,
        startedAt: new Date("2026-10-25T09:30:00.000Z"),
        lastCallAt: new Date("2026-10-25T09:31:00.000Z"),
        contextTokens: 41_000,
        startContextTokens: 33_000,
        full: false,
      },
      override: "start-fresh",
      tokens: { input: 10, output: 200, cacheRead: 30_000, cacheCreation: 11_000 },
    });
    await repository.add(older);
    await repository.add(newer);

    await expect(repository.find(newer.id)).resolves.toEqual(newer);
    await expect(repository.listIn({ kind: "chat", roleKey })).resolves.toEqual([newer, older]);
    await expect(
      repository.listIn({ kind: "chat", roleKey: `role-${randomUUID()}` }),
    ).resolves.toEqual([]);
  });

  it("lists the person's Threads on every Task, the newest first, and not their chat's", async () => {
    const roleKey = `role-${randomUUID()}`;
    const onTask = (taskId: string, startedAt: string): Thread =>
      aThread({
        id: randomUUID(),
        home: { kind: "task", taskId },
        roleKey,
        startedAt: new Date(startedAt),
      });
    const older = onTask(randomUUID(), "2026-10-25T09:00:00.000Z");
    const newer = onTask(randomUUID(), "2026-10-25T10:00:00.000Z");
    const someoneElses = aThread({
      id: randomUUID(),
      home: { kind: "task", taskId: randomUUID() },
      roleKey: `role-${randomUUID()}`,
    });
    for (const thread of [older, newer, someoneElses, aThreadOfItsOwn(roleKey)]) {
      await repository.add(thread);
    }

    await expect(repository.listOnTasksWith(roleKey)).resolves.toEqual([newer, older]);
  });

  it("keeps a Thread on an Initiative in its home, apart from the person's Threads on Tasks", async () => {
    const roleKey = `role-${randomUUID()}`;
    const home = { kind: "initiative", initiativeId: randomUUID() } as const;
    const shaping = aThread({ id: randomUUID(), home, roleKey, title: "Shaping" });
    await repository.add(shaping);

    await expect(repository.listIn(home)).resolves.toEqual([shaping]);
    await expect(repository.listOnTasksWith(roleKey)).resolves.toEqual([]);
  });

  it("finds a Thread by the engine session it has now", async () => {
    const roleKey = `role-${randomUUID()}`;
    const session = {
      id: randomUUID(),
      roleKey,
      cardVersion: 1,
      startedAt: AT,
      lastCallAt: undefined,
      contextTokens: 0,
      startContextTokens: undefined,
      full: false,
    };
    const thread = aThreadOfItsOwn(roleKey, { session });
    await repository.add(thread);

    await expect(repository.findBySession(session.id)).resolves.toEqual(thread);
    await expect(repository.findBySession(randomUUID())).resolves.toBeUndefined();
  });

  it("saves a change with the messages it logged, in their order", async () => {
    const thread = aThreadOfItsOwn(`role-${randomUUID()}`);
    await repository.add(thread);
    const messages: Message[] = [
      aUserMessage(thread, "Read the deploy workflow."),
      {
        kind: "tool-activity",
        id: randomUUID(),
        threadId: thread.id,
        roleKey: thread.roleKey,
        tool: "Read",
        summary: ".github/workflows/deploy-production.yml",
        at: AT,
      },
      {
        kind: "person",
        id: randomUUID(),
        threadId: thread.id,
        roleKey: thread.roleKey,
        text: "It deploys on every push to main.",
        at: AT,
      },
    ];

    const { thread: logged, event } = await repository.update(thread.id, (current) =>
      logMessages(current, messages, AT),
    );

    expect(logged.title).toBe("Read the deploy workflow");
    expect(event?.messages).toEqual(messages);
    await expect(repository.find(thread.id)).resolves.toEqual(logged);
    await expect(repository.messages(thread.id)).resolves.toEqual(messages);
  });

  it("saves nothing when the change changes nothing", async () => {
    const thread = aThreadOfItsOwn(`role-${randomUUID()}`, { title: "Deploys" });
    await repository.add(thread);

    const update = await repository.update(thread.id, (current) =>
      renameThread(current, "Deploys", AT),
    );

    expect(update).toEqual({ thread, event: undefined });
  });

  it("never loses one of two changes made at once", async () => {
    const thread = aThreadOfItsOwn(`role-${randomUUID()}`);
    await repository.add(thread);

    await Promise.all(
      ["First.", "Second."].map((text) =>
        repository.update(thread.id, (current) =>
          logMessages(current, [aUserMessage(current, text)], AT),
        ),
      ),
    );

    const texts = (await repository.messages(thread.id)).map((message) =>
      message.kind === "user" ? message.text : "",
    );
    expect(texts.toSorted()).toEqual(["First.", "Second."]);
  });

  it("refuses to change a Thread that isn't there", async () => {
    const id = randomUUID();

    await expect(
      repository.update(id, (current) => renameThread(current, "Deploys", AT)),
    ).rejects.toThrow(new ThreadNotFound(id));
  });

  it("lets an answered Decision's approval through once", async () => {
    const taskId = randomUUID();
    const thread = aThreadOfItsOwn(`role-${randomUUID()}`, { home: { kind: "task", taskId } });
    await repository.add(thread);
    const { thread: waiting } = await repository.update(thread.id, (current) =>
      openDecision(current, {
        id: randomUUID(),
        askedAt: AT,
        question: "Allow this call? Change the Developer.",
        context: "Why.",
        options: ["Allow once", "Deny"],
        recommendation: { option: 0, reason: "Needed." },
      }),
    );
    const decisionId = waiting.openDecision?.id ?? "";

    await expect(repository.spendApproval(decisionId)).resolves.toBe(true);
    await expect(repository.spendApproval(decisionId)).resolves.toBe(false);
    await expect(repository.spendApproval(randomUUID())).resolves.toBe(false);
    await expect(repository.decision(decisionId)).resolves.not.toHaveProperty("approvalSpentAt");
  });
});
