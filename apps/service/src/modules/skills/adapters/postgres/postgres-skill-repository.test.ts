import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { aSkill } from "../../domain/skill.fixtures.js";
import { turnOn } from "../../domain/skill-changes.js";
import { SkillTurnedOn } from "../../domain/skill-events.js";
import { currentVersionOf } from "../../domain/skill-version.js";
import { PostgresSkillRepository } from "./postgres-skill-repository.js";

let app: INestApplication;
let repository: PostgresSkillRepository;

beforeAll(async () => {
  ({ app } = await startTestApplication({
    database: true,
    providers: [PostgresSkillRepository],
  }));
  repository = app.get(PostgresSkillRepository);
});

afterAll(async () => {
  await app.close();
});

/** A skill of this test's own: every test file shares the database. */
function aSkillOfItsOwn(): ReturnType<typeof aSkill> {
  return aSkill({ name: `skill-${randomUUID()}` });
}

describe("PostgresSkillRepository", () => {
  it("keeps a skill as it was added, with its first version", async () => {
    const skill = aSkillOfItsOwn();

    await repository.add(skill);

    await expect(repository.find(skill.name)).resolves.toEqual(skill);
    await expect(repository.versions(skill.name)).resolves.toEqual([currentVersionOf(skill)]);
  });

  describe("update", () => {
    it("saves the change and returns it", async () => {
      const skill = aSkillOfItsOwn();
      await repository.add(skill);

      const { skill: updated, event } = await repository.update(skill.name, turnOn);

      expect(updated.state).toBe("on");
      expect(event).toBeInstanceOf(SkillTurnedOn);
      expect(event).toMatchObject({ skillName: skill.name, version: 1 });
      await expect(repository.find(skill.name)).resolves.toEqual(updated);
    });
  });
});
