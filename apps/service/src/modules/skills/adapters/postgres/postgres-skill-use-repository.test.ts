import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { aSkill } from "../../domain/skill.fixtures.js";
import { PostgresSkillRepository } from "./postgres-skill-repository.js";
import { PostgresSkillUseRepository } from "./postgres-skill-use-repository.js";
import { aProjectOfItsOwn, aUse } from "./postgres-skill-use-repository.fixtures.js";

let app: INestApplication;
let skills: PostgresSkillRepository;
let uses: PostgresSkillUseRepository;

beforeAll(async () => {
  ({ app } = await startTestApplication({
    database: true,
    providers: [PostgresSkillRepository, PostgresSkillUseRepository],
  }));
  skills = app.get(PostgresSkillRepository);
  uses = app.get(PostgresSkillUseRepository);
});

afterAll(async () => {
  await app.close();
});

const SINCE = new Date("2026-11-03T12:00:00.000Z");
const LATER = new Date("2026-11-09T12:00:00.000Z");

describe("PostgresSkillUseRepository", () => {
  it("keeps each use and counts them by library skill and by Project skill", async () => {
    const skill = aSkill({ name: `skill-${randomUUID()}` });
    await skills.add(skill);
    const projectId = aProjectOfItsOwn();
    const library = { kind: "library", skillName: skill.name } as const;
    const deploy = { kind: "project", projectId, key: "deploy" } as const;

    await expect(uses.add(aUse(library, LATER))).resolves.toBe(true);
    await uses.add(aUse(library, LATER));
    await uses.add(aUse(deploy, LATER));

    expect((await uses.libraryCounts(SINCE)).get(skill.name)).toBe(2);
    await expect(uses.projectCounts(projectId, SINCE)).resolves.toEqual(new Map([["deploy", 1]]));
  });
});
