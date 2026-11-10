import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { SkillRefused } from "../../domain/skill-refused.js";
import { PostgresSessionSkillRepository } from "./postgres-session-skill-repository.js";
import { aRecord } from "./postgres-session-skill-repository.fixtures.js";

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

describe("PostgresSessionSkillRepository", () => {
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
