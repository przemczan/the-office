import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { aSkill } from "../../domain/skill.fixtures.js";
import { saveVersion, turnOn } from "../../domain/skill-changes.js";
import { SkillNotFound } from "../../domain/skill-not-found.js";
import { SkillRefused } from "../../domain/skill-refused.js";
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

const savedAt = new Date("2026-10-25T11:00:00.000Z");

describe("PostgresSkillRepository", () => {
  it("refuses a second skill with a name it has", async () => {
    const skill = aSkillOfItsOwn();
    await repository.add(skill);

    await expect(repository.add({ ...skill, description: "Another." })).rejects.toThrow(
      new SkillRefused([`The library already has ${skill.name}.`]),
    );
    await expect(repository.find(skill.name)).resolves.toEqual(skill);
  });

  it("lists skills in the order they were added", async () => {
    const earlier = aSkillOfItsOwn();
    const later = { ...aSkillOfItsOwn(), addedAt: new Date(earlier.addedAt.getTime() + 1000) };
    await repository.add(later);
    await repository.add(earlier);

    const names = (await repository.list()).map((skill) => skill.name);

    expect(names.filter((name) => name === earlier.name || name === later.name)).toEqual([
      earlier.name,
      later.name,
    ]);
  });

  it("finds nothing for a name it doesn't have", async () => {
    await expect(repository.find("nowhere")).resolves.toBeUndefined();
    await expect(repository.versions("nowhere")).resolves.toEqual([]);
  });

  describe("update", () => {
    it("keeps each new version beside the earlier ones", async () => {
      const skill = aSkillOfItsOwn();
      await repository.add(skill);

      const { skill: saved } = await repository.update(skill.name, (current) =>
        saveVersion(current, "Writes the notes.", "b".repeat(64), savedAt),
      );

      await expect(repository.versions(skill.name)).resolves.toEqual([
        currentVersionOf(skill),
        {
          skillName: skill.name,
          version: 2,
          filesHash: "b".repeat(64),
          description: "Writes the notes.",
          savedAt,
        },
      ]);
      await expect(repository.find(skill.name)).resolves.toEqual(saved);
    });

    it("saves nothing when the change changes nothing", async () => {
      const skill = { ...aSkillOfItsOwn(), state: "on" as const };
      await repository.add(skill);

      const result = await repository.update(skill.name, turnOn);

      expect(result).toEqual({ skill, event: undefined });
    });

    it("loses neither of two versions saved at once", async () => {
      const skill = aSkillOfItsOwn();
      await repository.add(skill);

      await Promise.all(
        ["b", "c"].map((letter) =>
          repository.update(skill.name, (current) =>
            saveVersion(current, `Version ${letter}.`, letter.repeat(64), savedAt),
          ),
        ),
      );

      const versions = await repository.versions(skill.name);
      expect(versions.map((version) => version.version)).toEqual([1, 2, 3]);
      await expect(repository.find(skill.name)).resolves.toMatchObject({ version: 3 });
    });

    it("throws SkillNotFound for a name it doesn't have", async () => {
      await expect(repository.update("nowhere", turnOn)).rejects.toThrow(SkillNotFound);
    });
  });

  describe("remove", () => {
    it("forgets the skill and its versions, and returns it", async () => {
      const skill = aSkillOfItsOwn();
      await repository.add(skill);

      await expect(repository.remove(skill.name)).resolves.toEqual(skill);
      await expect(repository.find(skill.name)).resolves.toBeUndefined();
      await expect(repository.versions(skill.name)).resolves.toEqual([]);
    });

    it("lets the name be taken again, from version 1", async () => {
      const skill = aSkillOfItsOwn();
      await repository.add(skill);
      await repository.remove(skill.name);

      await repository.add(skill);

      await expect(repository.versions(skill.name)).resolves.toEqual([currentVersionOf(skill)]);
    });

    it("throws SkillNotFound for a name it doesn't have", async () => {
      await expect(repository.remove("nowhere")).rejects.toThrow(SkillNotFound);
    });
  });
});
