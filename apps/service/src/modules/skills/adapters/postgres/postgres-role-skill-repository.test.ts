import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { assignmentsChange, skillsOfRole, withRoleSkills } from "../../domain/role-skills.js";
import { aSkill } from "../../domain/skill.fixtures.js";
import { ANN_LEE, BEN_ITO } from "../../domain/user.fixtures.js";
import { PostgresRoleSkillRepository } from "./postgres-role-skill-repository.js";
import { PostgresSkillRepository } from "./postgres-skill-repository.js";

let app: INestApplication;
let repository: PostgresRoleSkillRepository;
let skills: PostgresSkillRepository;

beforeAll(async () => {
  ({ app } = await startTestApplication({
    database: true,
    providers: [PostgresRoleSkillRepository, PostgresSkillRepository],
  }));
  repository = app.get(PostgresRoleSkillRepository);
  skills = app.get(PostgresSkillRepository);
});

afterAll(async () => {
  await app.close();
});

/** A skill of the test's own in the library: every test file shares the database. */
async function aSkillOfItsOwn(): Promise<string> {
  const name = `skill-${randomUUID().slice(0, 8)}`;
  await skills.add(aSkill({ name }));
  return name;
}

/** Adds the skill to the Role's, as stored when the change runs. */
function adding(roleKey: string, skillName: string, at: Date) {
  return repository.update((current) =>
    assignmentsChange(
      current,
      withRoleSkills(current, roleKey, [...skillsOfRole(current, roleKey), skillName]),
      at,
      ANN_LEE,
    ),
  );
}

describe("PostgresRoleSkillRepository", () => {
  it("keeps the assignments and each Role's changes, newest first", async () => {
    const roleKey = `role-${randomUUID()}`;
    const [first, second] = [await aSkillOfItsOwn(), await aSkillOfItsOwn()];
    const earlier = new Date("2026-10-25T10:00:00.000Z");
    const later = new Date("2026-10-25T11:00:00.000Z");

    await adding(roleKey, first, earlier);
    await repository.update((current) =>
      assignmentsChange(current, withRoleSkills(current, roleKey, [second]), later, BEN_ITO),
    );

    expect(skillsOfRole(await repository.list(), roleKey)).toEqual([second]);
    await expect(repository.changes(roleKey)).resolves.toEqual([
      { roleKey, added: [second], removed: [first], changedAt: later, changedBy: BEN_ITO },
      { roleKey, added: [first], removed: [], changedAt: earlier, changedBy: ANN_LEE },
    ]);
  });
});
