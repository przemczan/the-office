import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { assignmentsChange, skillsOfRole, withRoleSkills } from "../../domain/role-skills.js";
import { aSkill } from "../../domain/skill.fixtures.js";
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
    ),
  );
}

describe("PostgresRoleSkillRepository", () => {
  it("keeps both of two changes made at once", async () => {
    const roleKey = `role-${randomUUID()}`;
    const [first, second] = [await aSkillOfItsOwn(), await aSkillOfItsOwn()];
    const at = new Date();

    await Promise.all([adding(roleKey, first, at), adding(roleKey, second, at)]);

    expect(skillsOfRole(await repository.list(), roleKey)).toEqual([first, second].toSorted());
    await expect(repository.changes(roleKey)).resolves.toHaveLength(2);
  });

  it("drops a removed skill's assignments", async () => {
    const roleKey = `role-${randomUUID()}`;
    const name = await aSkillOfItsOwn();
    await adding(roleKey, name, new Date());

    await skills.remove(name);

    expect(skillsOfRole(await repository.list(), roleKey)).toEqual([]);
  });
});
