import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { sql, TransactionRollbackError } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { Home, Thread } from "../../domain/thread.js";
import { logMessages } from "../../domain/thread-changes.js";
import { aThread, aUserMessage } from "../../domain/thread.fixtures.js";
import { PostgresChatActivityRepository } from "./postgres-chat-activity-repository.js";
import { PostgresThreadRepository } from "./postgres-thread-repository.js";
import { threadSeen } from "./thread-seen.schema.js";

let app: INestApplication;
let database: Database;
let repository: PostgresChatActivityRepository;
let threads: PostgresThreadRepository;

beforeAll(async () => {
  ({ app } = await startTestApplication({
    database: true,
    providers: [PostgresThreadRepository, PostgresChatActivityRepository],
  }));
  database = app.get(DATABASE);
  repository = app.get(PostgresChatActivityRepository);
  threads = app.get(PostgresThreadRepository);
});

afterAll(async () => {
  await app.close();
});

const AT = new Date("2026-11-06T10:00:00.000Z");

async function aThreadWithAnswer(home?: Home): Promise<{ thread: Thread; lastMessage: string }> {
  const roleKey = `role-${randomUUID()}`;
  const thread = aThread({
    id: randomUUID(),
    home: home ?? { kind: "chat", roleKey },
    roleKey,
  });
  await threads.add(thread);
  const answer = {
    ...aUserMessage(thread, "x"),
    at: AT,
    kind: "person",
    roleKey,
    text: "Done.",
  } as const;
  await threads.update(thread.id, (current) => logMessages(current, [answer], AT));
  return { thread, lastMessage: answer.id };
}

describe("PostgresChatActivityRepository", () => {
  it("reads an unseen answer until it is marked seen", async () => {
    const { thread, lastMessage } = await aThreadWithAnswer();
    expect((await repository.chatThread(thread.id))?.unseenAnswerAt).toEqual(AT);

    expect(await repository.markSeen(thread.id, lastMessage, AT)).toBe("moved");

    expect((await repository.chatThread(thread.id))?.unseenAnswerAt).toBeUndefined();
    expect(await repository.markSeen(thread.id, lastMessage, AT)).toBe("stayed");
  });

  it("knows only chat Threads", async () => {
    const { thread } = await aThreadWithAnswer({ kind: "task", taskId: randomUUID() });

    expect(await repository.chatThread(thread.id)).toBeUndefined();
    expect((await repository.chatThreads()).map(({ threadId }) => threadId)).not.toContain(
      thread.id,
    );
  });

  it("refuses a message of another Thread", async () => {
    const { thread } = await aThreadWithAnswer();
    const { lastMessage: elsewhere } = await aThreadWithAnswer();

    expect(await repository.markSeen(thread.id, elsewhere, AT)).toBe("no-such-message");
  });

  it("fills in the Threads from before the record as seen, chats alone", async () => {
    const migration = await readFile(
      new URL("../../../../../drizzle/0094_thread_seen.sql", import.meta.url),
      "utf8",
    );
    const filling = migration.split("--> statement-breakpoint").at(-1) ?? "";
    const chat = await aThreadWithAnswer();
    const onTask = await aThreadWithAnswer({ kind: "task", taskId: randomUUID() });

    const seenAfterFilling = await rolledBack(async (transaction) => {
      await transaction.delete(threadSeen);
      await transaction.execute(sql.raw(filling));
      return transaction.select().from(threadSeen);
    });
    const seen = (threadId: string): readonly string[] =>
      seenAfterFilling.filter((row) => row.threadId === threadId).map((row) => row.messageId);

    expect(seen(chat.thread.id)).toEqual([chat.lastMessage]);
    expect(seen(onTask.thread.id)).toEqual([]);
  });
});

/** What `read` found, with its changes undone: every test file shares the record. */
async function rolledBack<Result>(
  read: (transaction: Parameters<Parameters<Database["transaction"]>[0]>[0]) => Promise<Result>,
): Promise<Result> {
  let result: Result | undefined;
  await database
    .transaction(async (transaction) => {
      result = await read(transaction);
      transaction.rollback();
    })
    .catch((error: unknown) => {
      if (!(error instanceof TransactionRollbackError)) throw error;
    });
  if (result === undefined) throw new Error("Nothing was read.");
  return result;
}
