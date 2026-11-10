import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import type { Thread } from "../../domain/thread.js";
import { aThread } from "../../domain/thread.fixtures.js";
import { PostgresThreadRepository } from "./postgres-thread-repository.js";

// What postgres-thread-repository.test.ts and postgres-thread-repository.full.test.ts share.

export let app: INestApplication;

export let repository: PostgresThreadRepository;

/** A Thread in a chat of this test's own: every test file shares the database. */
export function aThreadOfItsOwn(roleKey: string, fields: Partial<Thread> = {}): Thread {
  return aThread({ id: randomUUID(), home: { kind: "chat", roleKey }, roleKey, ...fields });
}

export const AT = new Date("2026-10-25T10:00:00.000Z");

/** The hooks every test of both files runs. */
export function setUpEachTest(): void {
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
}
