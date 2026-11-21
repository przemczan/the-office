import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { PostgresAdbKeyRepository } from "./postgres-adb-key-repository.js";

let app: INestApplication;
let repository: PostgresAdbKeyRepository;

beforeAll(async () => {
  ({ app } = await startTestApplication({
    database: true,
    providers: [PostgresAdbKeyRepository],
  }));
  repository = app.get(PostgresAdbKeyRepository);
});

afterAll(async () => {
  await app.close();
});

function aKey(projectId: string, privateKey: string) {
  return {
    projectId,
    privateKey,
    publicKey: `${privateKey}-public office@${projectId}`,
    createdAt: new Date("2026-11-21T10:00:00.000Z"),
  };
}

describe("PostgresAdbKeyRepository", () => {
  it("keeps the Project's first key and answers it for every later one", async () => {
    const projectId = `project-${randomUUID()}`;
    expect(await repository.find(projectId)).toBeUndefined();

    const first = await repository.keepFirst(aKey(projectId, "first"));
    const second = await repository.keepFirst(aKey(projectId, "second"));

    expect(first).toEqual(aKey(projectId, "first"));
    expect(second).toEqual(first);
    expect(await repository.find(projectId)).toEqual(first);
  });
});
