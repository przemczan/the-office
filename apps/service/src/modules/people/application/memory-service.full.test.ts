import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { PostgresMemoryRepository } from "../adapters/postgres/postgres-memory-repository.js";
import { PostgresRoleRepository } from "../adapters/postgres/postgres-role-repository.js";
import type { MemoryNoteDraft } from "../domain/memory-note.js";
import { MemoryNoteNotFound } from "../domain/memory-note-not-found.js";
import { aRole, aRoleCard, CARD_CONTEXT } from "../domain/role.fixtures.js";
import { changeRoleCard, letGo } from "../domain/role-changes.js";
import { RoleMemoryChanged } from "../domain/role-events.js";
import { RoleNotFound } from "../domain/role-not-found.js";
import { RoleRefused } from "../domain/role-refused.js";
import { ANN_LEE, BEN_ITO } from "../domain/user.fixtures.js";
import { MemoryRepository } from "../ports/memory-repository.js";
import { RoleRepository } from "../ports/role-repository.js";
import { MemoryService } from "./memory-service.js";

let app: INestApplication;
let memory: MemoryService;
let published: unknown[];

beforeAll(async () => {
  ({ app } = await startTestApplication({
    database: true,
    imports: [EventsModule],
    providers: [
      { provide: RoleRepository, useClass: PostgresRoleRepository },
      { provide: MemoryRepository, useClass: PostgresMemoryRepository },
      MemoryService,
    ],
  }));
  memory = app.get(MemoryService);
  published = [];
  app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
});

afterAll(async () => {
  await app.close();
});

/** A person of this test's own, with Shared memory on or off: every test file shares the database. */
async function aPerson(sharedMemory: boolean): Promise<string> {
  const base = aRoleCard();
  const role = aRole({
    key: `role-${randomUUID()}`,
    card: aRoleCard({ capabilities: { ...base.capabilities, sharedMemory } }),
  });
  await app.get(RoleRepository).add(role);
  return role.key;
}

function aDraft(roleKey: string, fields: Partial<MemoryNoteDraft> = {}): MemoryNoteDraft {
  return {
    roleKey,
    projectId: undefined,
    text: "Prefers small PRs.",
    source: { kind: "agent", threadId: "thread-1", taskId: "task-1" },
    ...fields,
  };
}

describe("MemoryService", () => {
  it("keeps a note with its source and says the Memory changed", async () => {
    const roleKey = await aPerson(true);

    const note = await memory.write(aDraft(roleKey, { projectId: "p1" }));

    await expect(memory.read(roleKey)).resolves.toEqual({ inUse: true, notes: [note] });
    expect(note.source).toEqual({ kind: "agent", threadId: "thread-1", taskId: "task-1" });
    expect(published).toContainEqual(expect.any(RoleMemoryChanged));
  });

  it("keeps the user who wrote a note, each their own", async () => {
    const roleKey = await aPerson(true);

    const anns = await memory.write(aDraft(roleKey, { source: { kind: "user", user: ANN_LEE } }));
    const bens = await memory.write(aDraft(roleKey, { source: { kind: "user", user: BEN_ITO } }));

    const { notes } = await memory.read(roleKey);
    expect(notes.find(({ id }) => id === anns.id)?.source).toEqual({ kind: "user", user: ANN_LEE });
    expect(notes.find(({ id }) => id === bens.id)?.source).toEqual({ kind: "user", user: BEN_ITO });
  });

  it("writes nothing while Shared memory is off, and keeps what was there", async () => {
    const roleKey = await aPerson(true);
    const note = await memory.write(aDraft(roleKey));
    await app
      .get(RoleRepository)
      .update(roleKey, (role) =>
        changeRoleCard(
          role,
          { ...role.card, capabilities: { ...role.card.capabilities, sharedMemory: false } },
          CARD_CONTEXT,
          new Date(),
          null,
        ),
      );

    await expect(memory.write(aDraft(roleKey))).rejects.toThrow(RoleRefused);

    await expect(memory.read(roleKey)).resolves.toEqual({ inUse: false, notes: [note] });
  });

  it("keeps a let-go person's Memory readable and unused, and writes nothing to it", async () => {
    const roleKey = await aPerson(true);
    const note = await memory.write(aDraft(roleKey));
    await app.get(RoleRepository).changeStanding(roleKey, (role) => letGo(role, new Date()));

    await expect(memory.write(aDraft(roleKey))).rejects.toThrow(RoleRefused);

    await expect(memory.read(roleKey)).resolves.toEqual({ inUse: false, notes: [note] });
  });

  it("deletes one note, or all of them, also while Shared memory is off", async () => {
    const roleKey = await aPerson(true);
    const first = await memory.write(aDraft(roleKey, { text: "First." }));
    const second = await memory.write(aDraft(roleKey, { text: "Second." }));

    await memory.remove(roleKey, first.id);
    await expect(memory.read(roleKey)).resolves.toMatchObject({ notes: [second] });
    await expect(memory.remove(roleKey, first.id)).rejects.toThrow(MemoryNoteNotFound);

    await memory.clear(roleKey);
    await expect(memory.read(roleKey)).resolves.toMatchObject({ notes: [] });
  });

  it("refuses a Memory of a person nobody fills", async () => {
    await expect(memory.read("nobody")).rejects.toThrow(RoleNotFound);
  });
});
