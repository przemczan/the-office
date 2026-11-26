import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { eq, sql, type SQL } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { freshTestDatabase, type FreshTestDatabase } from "../../../../../test/test-database.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { EarlierRecords } from "../../../../platform/earlier-records/earlier-records.js";
import { hardSwitchesOf } from "../../domain/authority.js";
import { CARETAKER } from "../../domain/known-roles.js";
import type { MemoryNote } from "../../domain/memory-note.js";
import { aRole, aRoleCard } from "../../domain/role.fixtures.js";
import type { UserRef } from "../../domain/user.js";
import { BEN_ITO } from "../../domain/user.fixtures.js";
import { memoryNotes } from "./memory.schema.js";
import { PeopleEarlierRecords } from "./people-earlier-records.js";
import { PostgresMemoryRepository } from "./postgres-memory-repository.js";
import { PostgresRoleRepository } from "./postgres-role-repository.js";
import { roleCardVersions } from "./roles.schema.js";

// A claim changes every row lacking a user, so it runs on a database no other test file shares.
let ownDatabase: FreshTestDatabase;
let app: INestApplication;

beforeAll(async () => {
  ownDatabase = await freshTestDatabase();
});

afterAll(async () => {
  await ownDatabase.drop();
});

beforeEach(async () => {
  ({ app } = await startTestApplication({
    database: { url: ownDatabase.url },
    providers: [PostgresRoleRepository, PostgresMemoryRepository, PeopleEarlierRecords],
  }));
});

afterEach(async () => {
  await app.close();
});

const FIRST_USER = { userId: randomUUID(), name: "Dee Ray" };
const AT = new Date("2026-11-01T10:00:00.000Z");
/** A user field as migration 0143 left it on what a user did before users existed. */
const KEPT_BEFORE_USERS = sql`'null'::jsonb`;

function database(): Database {
  return app.get<Database>(DATABASE);
}

/**
 * A Role whose card versions and Memory are kept as the migration left them before users existed:
 * what a user did names nobody (jsonb null); and since then, a version Ben Ito saved, one the
 * person changed on their own (no user, SQL null), a note Ben wrote and an Agent's note.
 */
async function earlierRecords() {
  const role = aRole({ key: `role-${randomUUID()}`, hiredAt: AT, cardSavedAt: AT });
  await app.get(PostgresRoleRepository).add(role);
  await database()
    .update(roleCardVersions)
    .set({ savedBy: KEPT_BEFORE_USERS })
    .where(eq(roleCardVersions.roleKey, role.key));
  const version = (
    number: number,
    fields: { proposedBy?: string; savedBy: UserRef | SQL | null },
  ) => ({
    roleKey: role.key,
    version: number,
    card: {
      ...aRoleCard({ taskLimit: number }),
      hardSwitches: hardSwitchesOf(role.key, {}),
    },
    changes: [],
    savedAt: AT,
    ...fields,
  });
  await database()
    .insert(roleCardVersions)
    .values([
      version(2, { proposedBy: "cto", savedBy: KEPT_BEFORE_USERS }),
      version(3, { savedBy: BEN_ITO }),
      version(4, { proposedBy: "planner", savedBy: null }),
    ]);
  const note = (text: string, source: MemoryNote["source"]): MemoryNote => ({
    id: randomUUID(),
    roleKey: role.key,
    projectId: undefined,
    text,
    source,
    writtenAt: AT,
  });
  const notes = [
    note("Before users.", { kind: "user", user: null }),
    note("Ben's.", { kind: "user", user: BEN_ITO }),
    note("The Agent's.", { kind: "agent", threadId: randomUUID(), taskId: undefined }),
  ];
  for (const each of notes) await app.get(PostgresMemoryRepository).append(each);
  return role.key;
}

async function recordsOf(roleKey: string) {
  const versions = await app.get(PostgresRoleRepository).versions(roleKey);
  const notes = await database()
    .select({ text: memoryNotes.text, source: memoryNotes.source })
    .from(memoryNotes)
    .where(eq(memoryNotes.roleKey, roleKey));
  return {
    versions: versions
      .map(({ version, savedBy }) => ({ version, savedBy }))
      .toSorted((first, second) => first.version - second.version),
    notes: Object.fromEntries(notes.map(({ text, source }) => [text, source])),
  };
}

async function caretakersFirstVersion() {
  const versions = await app.get(PostgresRoleRepository).versions(CARETAKER);
  return versions.find(({ version }) => version === 1)?.savedBy;
}

describe("People's claim on its records from before users existed", () => {
  it("names the first user in what a user did, once, leaving Ben's own and what no user did as they are", async () => {
    const roleKey = await earlierRecords();

    await app.get(EarlierRecords).claimFor(FIRST_USER);

    const claimed = await recordsOf(roleKey);
    expect(claimed.versions).toEqual([
      { version: 1, savedBy: FIRST_USER },
      { version: 2, savedBy: FIRST_USER },
      { version: 3, savedBy: BEN_ITO },
      { version: 4, savedBy: null },
    ]);
    expect(claimed.notes).toEqual({
      "Before users.": { kind: "user", user: FIRST_USER },
      "Ben's.": { kind: "user", user: BEN_ITO },
      "The Agent's.": { kind: "agent", threadId: expect.any(String) },
    });
    // The built-in Caretaker, seeded by a migration, was hired by no user.
    expect(await caretakersFirstVersion()).toBeNull();

    await app.get(EarlierRecords).claimFor({ userId: randomUUID(), name: "Eve Later" });
    expect(await recordsOf(roleKey)).toEqual(claimed);
  });
});
