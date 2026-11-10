import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Message } from "../../domain/message.js";
import { logMessages } from "../../domain/thread-changes.js";
import { aUserMessage } from "../../domain/thread.fixtures.js";
import {
  repository,
  aThreadOfItsOwn,
  AT,
  setUpEachTest,
} from "./postgres-thread-repository.fixtures.js";

setUpEachTest();

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
        officeInstructionsVersion: 3,
        engineId: "claude-code",
        startedAt: new Date("2026-10-25T09:30:00.000Z"),
        lastCallAt: new Date("2026-10-25T09:31:00.000Z"),
        contextTokens: 41_000,
        startContextTokens: 33_000,
        full: false,
        changesAllowed: false,
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
});
