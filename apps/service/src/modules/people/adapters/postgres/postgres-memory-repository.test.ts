import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import type { MemoryNote } from "../../domain/memory-note.js";
import { aRole } from "../../domain/role.fixtures.js";
import { PostgresMemoryRepository } from "./postgres-memory-repository.js";
import { PostgresRoleRepository } from "./postgres-role-repository.js";

let app: INestApplication;
let memory: PostgresMemoryRepository;
let roleKey: string;

beforeAll(async () => {
  ({ app } = await startTestApplication({
    database: true,
    providers: [PostgresRoleRepository, PostgresMemoryRepository],
  }));
  memory = app.get(PostgresMemoryRepository);
});

afterAll(async () => {
  await app.close();
});

/** A person of this test's own: every test file shares the database. */
async function aPerson(): Promise<string> {
  const role = aRole({ key: `role-${randomUUID()}` });
  await app.get(PostgresRoleRepository).add(role);
  return role.key;
}

function aNote(fields: Partial<MemoryNote> = {}): MemoryNote {
  return {
    id: randomUUID(),
    roleKey,
    projectId: undefined,
    text: "Prefers small PRs.",
    source: { kind: "agent", threadId: "thread-1", taskId: undefined },
    writtenAt: new Date("2026-10-27T10:00:00.000Z"),
    ...fields,
  };
}

describe("PostgresMemoryRepository", () => {
  it("lists the notes newest first, as they were written", async () => {
    roleKey = await aPerson();
    const older = aNote({ writtenAt: new Date("2026-10-27T09:00:00.000Z") });
    const newer = aNote({ projectId: "p1", source: { kind: "user", user: null } });
    await memory.append(older);
    await memory.append(newer);

    await expect(memory.list(roleKey)).resolves.toEqual([newer, older]);
  });
});
