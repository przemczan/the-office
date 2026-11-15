import { describe, expect, it } from "vitest";
import type { RoleSkillAssignment } from "../domain/role-skills.js";
import type { SessionSkillRecord } from "../domain/session-skills.js";
import type { Skill } from "../domain/skill.js";
import { aSkill } from "../domain/skill.fixtures.js";
import { RoleSkillRepository } from "../ports/role-skill-repository.js";
import { SessionSkillRepository } from "../ports/session-skill-repository.js";
import { SkillRepository } from "../ports/skill-repository.js";
import { SkillCommands } from "./skill-commands.js";

function notUsed(): never {
  throw new Error("not used by SkillCommands");
}

function skillCommandsOver(
  library: readonly Skill[],
  assignments: readonly RoleSkillAssignment[],
  records: readonly SessionSkillRecord[],
): SkillCommands {
  const skills = {
    list: async () => library,
    add: notUsed,
    find: notUsed,
    versions: notUsed,
    update: notUsed,
    remove: notUsed,
  } as unknown as SkillRepository;
  const sessionRecords = {
    find: async (sessionId: string) => records.find((record) => record.sessionId === sessionId),
    add: notUsed,
    list: notUsed,
    remove: notUsed,
  } as unknown as SessionSkillRepository;
  const roleSkills = {
    list: async () => assignments,
    update: notUsed,
    changes: notUsed,
  } as unknown as RoleSkillRepository;
  return new SkillCommands(skills, sessionRecords, roleSkills);
}

const tdd = aSkill({ name: "tdd", description: "Tests first.", state: "on" });
const notes = aSkill({ name: "notes", description: "Writes notes.", state: "on", everyone: true });
const off = aSkill({ name: "drafts", description: "Off.", state: "off", everyone: true });
const otherRoles = aSkill({ name: "deploy", description: "Not this Role's.", state: "on" });

describe("SkillCommands", () => {
  it("offers a new session the Role's skills and those for everyone, only while on", async () => {
    const commands = skillCommandsOver(
      [tdd, notes, off, otherRoles],
      [
        { roleKey: "developer", skillName: "tdd" },
        { roleKey: "reviewer", skillName: "deploy" },
      ],
      [],
    );

    expect(await commands.forRole("developer")).toEqual([
      { name: "notes", description: "Writes notes." },
      { name: "tdd", description: "Tests first." },
    ]);
  });

  it("offers a session that goes on the library skills it recorded, never its Project skills", async () => {
    const commands = skillCommandsOver(
      [tdd, notes],
      [],
      [
        {
          sessionId: "session-1",
          skills: [
            { name: "tdd", version: 1, filesHash: "a".repeat(64) },
            { name: "notes", version: 1, filesHash: "a".repeat(64) },
          ],
          projectId: "admin-panel",
          projectSkills: [{ key: "deploy", listedAs: "deploy" }],
          projectSkillsOff: [],
          preparedAt: new Date("2026-11-01T09:00:00.000Z"),
        },
      ],
    );

    expect(await commands.ofSession("session-1")).toEqual([
      { name: "notes", description: "Writes notes." },
      { name: "tdd", description: "Tests first." },
    ]);
    expect(await commands.ofSession("no-such-session")).toEqual([]);
  });
});
