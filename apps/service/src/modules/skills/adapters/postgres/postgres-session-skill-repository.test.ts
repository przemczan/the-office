import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
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
  it("keeps what a session got", async () => {
    const record = aRecord({ projectSkills: [], projectSkillsOff: ["deploy", "ship"] });

    await repository.add(record);

    await expect(repository.find(record.sessionId)).resolves.toEqual(record);
    expect(await repository.list()).toContainEqual(record);
  });
});
