import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { Home, Thread } from "../../domain/thread.js";
import { logMessages } from "../../domain/thread-changes.js";
import { aThread, aUserMessage } from "../../domain/thread.fixtures.js";
import { PostgresChatActivityRepository } from "./postgres-chat-activity-repository.js";
import { PostgresThreadRepository } from "./postgres-thread-repository.js";

// What postgres-chat-activity-repository.test.ts and postgres-chat-activity-repository.full.test.ts share.

export let app: INestApplication;

export let database: Database;

export let repository: PostgresChatActivityRepository;

export let threads: PostgresThreadRepository;

export const AT = new Date("2026-11-06T10:00:00.000Z");

export async function aThreadWithAnswer(
  home?: Home,
): Promise<{ thread: Thread; lastMessage: string }> {
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

/** The hooks every test of both files runs. */
export function setUpEachTest(): void {
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
}
