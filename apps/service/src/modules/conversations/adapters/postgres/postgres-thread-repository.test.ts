import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Message } from "../../domain/message.js";
import type { Thread } from "../../domain/thread.js";
import { logMessages, openDecision } from "../../domain/thread-changes.js";
import type { LoggedMessagesRange } from "../../ports/thread-repository.js";
import { aUserMessage } from "../../domain/thread.fixtures.js";
import {
  repository,
  aThreadOfItsOwn,
  AT,
  setUpEachTest,
} from "./postgres-thread-repository.fixtures.js";

setUpEachTest();

/** A time on a day only this file's range test logs messages on. */
const at = (time: string) => new Date(`2031-03-04T${time}:00.000Z`);

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

  it("keeps a call made from a chat on no Task, with its kind, apart from Waiting on you", async () => {
    const thread = aThreadOfItsOwn(`role-${randomUUID()}`);
    await repository.add(thread);
    const call = {
      kind: "request" as const,
      question: "Set up the Project's commands.",
      context: "The user asked for it.",
      options: [],
      recommendation: { option: 0, reason: "Only Devops drafts them." },
      putTo: "devops",
      askedAt: AT,
    };

    const { thread: waiting } = await repository.update(thread.id, (latest) =>
      openDecision(latest, { ...call, id: randomUUID() }),
    );
    const [opened] = waiting.openDecisions;

    expect(opened).toMatchObject({ kind: "request", taskId: undefined, putTo: "devops" });
    await expect(repository.decision(opened?.id ?? "")).resolves.toEqual(opened);
    await expect(repository.find(thread.id)).resolves.toMatchObject({ openDecisions: [opened] });
    expect(await repository.unansweredOnNoTask()).toContainEqual(opened);
    // One open call per chat Thread holds in the database too, past the domain's own rule.
    await expect(
      repository.update(thread.id, (latest) =>
        openDecision({ ...latest, openDecisions: [] }, { ...call, id: randomUUID() }),
      ),
    ).rejects.toThrow(/"decisions"/);
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

  it("reads the messages logged in a range, by the Threads' person and home, the first logged first", async () => {
    const roleKey = `role-${randomUUID()}`;
    const taskId = randomUUID();
    const chat = aThreadOfItsOwn(roleKey);
    const onTask = aThreadOfItsOwn(roleKey, { home: { kind: "task", taskId } });
    const someoneElsesOnTask = aThreadOfItsOwn(`role-${randomUUID()}`, {
      home: { kind: "task", taskId },
    });
    for (const thread of [chat, onTask, someoneElsesOnTask]) await repository.add(thread);
    const log = async (thread: Thread, text: string, time: string): Promise<Message> => {
      const message = { ...aUserMessage(thread, text), at: at(time) };
      await repository.update(thread.id, (current) => logMessages(current, [message], AT));
      return message;
    };
    const before = await log(chat, "Before the range.", "08:59");
    const first = await log(onTask, "First.", "09:00");
    const second = await log(chat, "Second.", "09:30");
    const elses = await log(someoneElsesOnTask, "Someone else's.", "09:40");
    const last = await log(onTask, "Last.", "10:00");
    await log(onTask, "After the range.", "10:01");
    const range = { from: at("09:00"), to: at("10:00") };
    const read = async (narrowed: Partial<LoggedMessagesRange>) =>
      (await repository.loggedIn({ ...range, ...narrowed })).map(({ thread, message }) => [
        thread.id,
        message.id,
      ]);

    await expect(read({ roleKey })).resolves.toEqual([
      [onTask.id, first.id],
      [chat.id, second.id],
      [onTask.id, last.id],
    ]);
    await expect(read({ homes: [{ kind: "task", taskId }] })).resolves.toEqual([
      [onTask.id, first.id],
      [someoneElsesOnTask.id, elses.id],
      [onTask.id, last.id],
    ]);
    await expect(
      read({
        roleKey,
        homes: [
          { kind: "chat", roleKey },
          { kind: "initiative", initiativeId: taskId },
        ],
      }),
    ).resolves.toEqual([[chat.id, second.id]]);
    await expect(read({ roleKey, homes: [] })).resolves.toEqual([]);
    await expect(read({ roleKey, from: at("08:00"), to: at("08:59") })).resolves.toEqual([
      [chat.id, before.id],
    ]);
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
