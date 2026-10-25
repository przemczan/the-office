import { describe, expect, it } from "vitest";
import { aSkill } from "./skill.fixtures.js";
import {
  allowedSkillNames,
  librarySkillsFor,
  projectSkillsFrom,
  sessionSkillRecord,
  skillOverridesOf,
  suffixMatches,
  type SessionSkill,
} from "./session-skills.js";

const preparedAt = new Date("2026-10-25T12:00:00.000Z");
const review: SessionSkill = { name: "review", version: 2, filesHash: "b".repeat(64) };

describe("librarySkillsFor", () => {
  it("gives the Role's skills and the skills for everyone, only while on, by name", () => {
    const library = [
      aSkill({ name: "tdd", state: "on" }),
      aSkill({ name: "house-style", state: "on", everyone: true }),
      aSkill({ name: "changelog", state: "waiting-for-review", everyone: true }),
      aSkill({ name: "grilling", state: "off" }),
      aSkill({ name: "security-review", state: "on" }),
    ];

    expect(librarySkillsFor(library, ["tdd", "grilling", "gone"])).toEqual([
      { name: "house-style", version: 1, filesHash: "a".repeat(64) },
      { name: "tdd", version: 1, filesHash: "a".repeat(64) },
    ]);
  });
});

describe("projectSkillsFrom", () => {
  it("finds skills and commands at any depth, by their bare names", () => {
    expect(
      projectSkillsFrom([
        ".claude/skills/deploy/SKILL.md",
        "apps/web/.claude/skills/release/SKILL.md",
        "apps/api/.claude/skills/deploy/SKILL.md",
        ".claude/skills/deploy/scripts/run.md",
        ".claude/commands/ship.md",
        ".claude/commands/frontend/notes.md",
        "docs/.claude/notes.md",
      ]),
    ).toEqual({ skills: ["deploy", "release"], commands: ["notes", "ship"] });
  });
});

describe("sessionSkillRecord", () => {
  const projectSkills = { skills: ["deploy", "review"], commands: ["ship"] };

  it("allows the Project's skills when the Project uses them", () => {
    const record = sessionSkillRecord("s-1", [review], projectSkills, true, preparedAt);

    expect(record).toEqual({
      sessionId: "s-1",
      skills: [review],
      projectSkills: ["deploy", "review"],
      projectSkillsOff: [],
      preparedAt,
    });
    expect(allowedSkillNames(record)).toEqual(["office:review", "deploy", "review"]);
    expect(skillOverridesOf(record)).toEqual({});
  });

  it("turns each of the Project's skills and commands off when the Project doesn't use them", () => {
    const record = sessionSkillRecord("s-1", [review], projectSkills, false, preparedAt);

    expect(allowedSkillNames(record)).toEqual(["office:review"]);
    expect(skillOverridesOf(record)).toEqual({ deploy: "off", review: "off", ship: "off" });
  });

  it("has no Project skills for a session outside a Project", () => {
    const record = sessionSkillRecord("s-1", [review], undefined, true, preparedAt);

    expect(allowedSkillNames(record)).toEqual(["office:review"]);
    expect(skillOverridesOf(record)).toEqual({});
  });
});

describe("suffixMatches", () => {
  it("reports an allowed Project skill named as one of the session's library skills", () => {
    const projectSkills = { skills: ["deploy", "review"], commands: [] };

    expect(
      suffixMatches(sessionSkillRecord("s-1", [review], projectSkills, true, preparedAt)),
    ).toEqual([
      "The Project's skill review also allows the library's office:review, which this session has too.",
    ]);
  });

  it("reports nothing when the Project's skills are off", () => {
    const projectSkills = { skills: ["review"], commands: [] };

    expect(
      suffixMatches(sessionSkillRecord("s-1", [review], projectSkills, false, preparedAt)),
    ).toEqual([]);
  });
});
