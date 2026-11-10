import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { aSkill } from "../../domain/skill.fixtures.js";
import type { UsedSkill } from "../../domain/skill-uses.js";
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

// A year no other file's uses reach, as the prune removes every use up to its time.
const SINCE = new Date("2003-01-01T12:00:00.000Z");
const JUST_AFTER = new Date(SINCE.getTime() + 1);

async function aLibrarySkill(): Promise<UsedSkill & { readonly kind: "library" }> {
  const skill = aSkill({ name: `skill-${randomUUID()}` });
  await skills.add(skill);
  return { kind: "library", skillName: skill.name };
}

describe("PostgresSkillUseRepository", () => {
  it("counts only the uses after the window's start", async () => {
    const library = await aLibrarySkill();
    const projectId = aProjectOfItsOwn();
    const deploy = { kind: "project", projectId, key: "deploy" } as const;
    for (const skill of [library, deploy]) {
      await uses.add(aUse(skill, SINCE));
      await uses.add(aUse(skill, JUST_AFTER));
    }

    expect((await uses.libraryCounts(SINCE)).get(library.skillName)).toBe(1);
    await expect(uses.projectCounts(projectId, SINCE)).resolves.toEqual(new Map([["deploy", 1]]));
  });

  it("counts a Project skill per Project and key", async () => {
    const [shop, admin] = [aProjectOfItsOwn(), aProjectOfItsOwn()];
    await uses.add(aUse({ kind: "project", projectId: shop, key: "deploy" }, JUST_AFTER));
    await uses.add(aUse({ kind: "project", projectId: shop, key: "ops:release" }, JUST_AFTER));
    await uses.add(aUse({ kind: "project", projectId: admin, key: "deploy" }, JUST_AFTER));

    await expect(uses.projectCounts(shop, SINCE)).resolves.toEqual(
      new Map([
        ["deploy", 1],
        ["ops:release", 1],
      ]),
    );
  });

  it("takes a removed library skill's uses along, and keeps none for it after", async () => {
    const library = await aLibrarySkill();
    await uses.add(aUse(library, JUST_AFTER));

    await skills.remove(library.skillName);

    expect((await uses.libraryCounts(SINCE)).has(library.skillName)).toBe(false);
    await expect(uses.add(aUse(library, JUST_AFTER))).resolves.toBe(false);
    expect((await uses.libraryCounts(SINCE)).has(library.skillName)).toBe(false);
  });

  it("removes the uses up to a time and keeps those after it", async () => {
    const library = await aLibrarySkill();
    await uses.add(aUse(library, SINCE));
    await uses.add(aUse(library, JUST_AFTER));

    await uses.removeUntil(SINCE);

    const before = new Date(SINCE.getTime() - 1);
    expect((await uses.libraryCounts(before)).get(library.skillName)).toBe(1);
  });
});
