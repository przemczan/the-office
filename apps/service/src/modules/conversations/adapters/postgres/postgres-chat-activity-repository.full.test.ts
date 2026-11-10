import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sql, TransactionRollbackError } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { type Database } from "../../../../platform/database/database.js";
import { threadSeen } from "./thread-seen.schema.js";
import {
  database,
  repository,
  AT,
  aThreadWithAnswer,
  setUpEachTest,
} from "./postgres-chat-activity-repository.fixtures.js";

setUpEachTest();

describe("PostgresChatActivityRepository", () => {
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
