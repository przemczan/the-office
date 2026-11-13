import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { freshTestDatabase, type FreshTestDatabase } from "../../../../../test/test-database.js";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { EarlierRecords } from "../../../../platform/earlier-records/earlier-records.js";
import type { UserRef } from "../../domain/user.js";
import { BEN_ITO } from "../../domain/user.fixtures.js";
import { PostgresRoleSkillRepository } from "./postgres-role-skill-repository.js";
import { roleSkillChanges } from "./skills.schema.js";
import { SkillsEarlierRecords } from "./skills-earlier-records.js";

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
    providers: [PostgresRoleSkillRepository, SkillsEarlierRecords],
  }));
});

afterEach(async () => {
  await app.close();
});

const FIRST_USER = { userId: randomUUID(), name: "Dee Ray" };

/**
 * A Role's skill changes as the migration left them: one from before users existed names nobody
 * (jsonb null); since then, one Ben Ito made and one no user made (SQL null).
 */
async function earlierRecords(): Promise<string> {
  const roleKey = `role-${randomUUID()}`;
  const change = (skill: string, at: string, changedBy: UserRef | SQL | null) => ({
    roleKey,
    added: [skill],
    removed: [],
    changedAt: new Date(at),
    changedBy,
  });
  await app
    .get<Database>(DATABASE)
    .insert(roleSkillChanges)
    .values([
      change("before-users", "2026-11-01T10:00:00.000Z", sql`'null'::jsonb`),
      change("bens", "2026-11-01T11:00:00.000Z", BEN_ITO),
      change("nobodys", "2026-11-01T12:00:00.000Z", null),
    ]);
  return roleKey;
}

async function changesOf(roleKey: string) {
  const changes = await app.get(PostgresRoleSkillRepository).changes(roleKey);
  return changes.map(({ added, changedBy: by }) => ({ skill: added[0], by }));
}

describe("Skills' claim on its records from before users existed", () => {
  it("names the first user in a change from before users existed, once, leaving the rest as they are", async () => {
    const roleKey = await earlierRecords();

    await app.get(EarlierRecords).claimFor(FIRST_USER);

    const claimed = await changesOf(roleKey);
    expect(claimed).toEqual([
      { skill: "nobodys", by: null },
      { skill: "bens", by: BEN_ITO },
      { skill: "before-users", by: FIRST_USER },
    ]);

    await app.get(EarlierRecords).claimFor({ userId: randomUUID(), name: "Eve Later" });
    expect(await changesOf(roleKey)).toEqual(claimed);
  });
});
