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
    const newer = aNote({ projectId: "p1", source: { kind: "user" } });
    await memory.append(older);
    await memory.append(newer);

    await expect(memory.list(roleKey)).resolves.toEqual([newer, older]);
  });

  it("keeps the notes of two sessions writing at once", async () => {
    roleKey = await aPerson();
    const notes = Array.from({ length: 8 }, () => aNote());

    await Promise.all(notes.map((note) => memory.append(note)));

    await expect(memory.list(roleKey)).resolves.toHaveLength(8);
  });

  it("deletes one note, only from its own person", async () => {
    roleKey = await aPerson();
    const note = aNote();
    const keptNote = aNote();
    await memory.append(note);
    await memory.append(keptNote);
    const otherPerson = await aPerson();

    await expect(memory.remove(otherPerson, note.id)).resolves.toBe(false);
    await expect(memory.remove(roleKey, note.id)).resolves.toBe(true);
    await expect(memory.remove(roleKey, note.id)).resolves.toBe(false);

    await expect(memory.list(roleKey)).resolves.toEqual([keptNote]);
  });

  it("clears a person's notes and no one else's", async () => {
    roleKey = await aPerson();
    await memory.append(aNote());
    const otherPerson = await aPerson();
    const othersNote = aNote({ roleKey: otherPerson });
    await memory.append(othersNote);

    await memory.clear(roleKey);

    await expect(memory.list(roleKey)).resolves.toEqual([]);
    await expect(memory.list(otherPerson)).resolves.toEqual([othersNote]);
  });
});
