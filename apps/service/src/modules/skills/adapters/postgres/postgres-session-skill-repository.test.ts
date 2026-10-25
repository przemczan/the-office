import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import type { SessionSkillRecord } from "../../domain/session-skills.js";
import { SkillRefused } from "../../domain/skill-refused.js";
import { PostgresSessionSkillRepository } from "./postgres-session-skill-repository.js";

let app: INestApplication;
let repository: PostgresSessionSkillRepository;

beforeAll(async () => {
  ({ app } = await startTestApplication({
    database: true,
    providers: [PostgresSessionSkillRepository],
  }));
  repository = app.get(PostgresSessionSkillRepository);
});

afterAll(async () => {
  await app.close();
});

/** A record of this test's own: every test file shares the database. */
function aRecord(fields: Partial<SessionSkillRecord> = {}): SessionSkillRecord {
  return {
    sessionId: randomUUID(),
    skills: [{ name: "tdd", version: 2, filesHash: "a".repeat(64) }],
    projectSkills: ["deploy"],
    projectSkillsOff: [],
    preparedAt: new Date("2026-10-25T12:00:00.000Z"),
    ...fields,
  };
}

describe("PostgresSessionSkillRepository", () => {
  it("keeps what a session got", async () => {
    const record = aRecord({ projectSkills: [], projectSkillsOff: ["deploy", "ship"] });

    await repository.add(record);

    await expect(repository.find(record.sessionId)).resolves.toEqual(record);
    expect(await repository.list()).toContainEqual(record);
  });

  it("refuses to change a session's set", async () => {
    const record = aRecord();
    await repository.add(record);

    await expect(repository.add({ ...record, skills: [] })).rejects.toThrow(SkillRefused);
    await expect(repository.find(record.sessionId)).resolves.toEqual(record);
  });

  it("forgets a session's record", async () => {
    const record = aRecord();
    await repository.add(record);

    await repository.remove(record.sessionId);
    await repository.remove(record.sessionId);

    await expect(repository.find(record.sessionId)).resolves.toBeUndefined();
  });
});
