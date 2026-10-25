import { describe, expect, it } from "vitest";
import { aSkill } from "./skill.fixtures.js";
import {
  allowedSkillNames,
  expectedSkillNames,
  librarySkillsFor,
  projectSkillsFrom,
  sessionSkillRecord,
  skillOverridesOf,
  suffixMatches,
  type ProjectSkill,
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

const file = (path: string, text = "") => ({ path, text });
const deploy: ProjectSkill = { key: "deploy", listedAs: "deploy" };
const reviewSkill: ProjectSkill = { key: "review", listedAs: "review" };
const ship: ProjectSkill = { key: "ship", listedAs: "ship" };
const release: ProjectSkill = { key: "release", listedAs: undefined };

describe("projectSkillsFrom", () => {
  it("names skills and commands as the engine lists them, nested ones only later", () => {
    expect(
      projectSkillsFrom([
        file(".claude/skills/deploy/SKILL.md", "---\nname: deploy\n---\n"),
        file(".claude/skills/deploy-folder/SKILL.md", "---\nname: deploy-named\n---\n"),
        file(".claude/skills/plain/SKILL.md", "No frontmatter."),
        file("apps/web/.claude/skills/release/SKILL.md"),
        file(".claude/skills/deploy/scripts/run.md"),
        file(".claude/commands/ship.md"),
        file(".claude/commands/frontend/notes.md"),
        file("apps/web/.claude/commands/migrate.md"),
        file("docs/.claude/notes.md"),
      ]),
    ).toEqual([
      { key: "deploy", listedAs: "deploy" },
      { key: "deploy-folder", listedAs: "deploy-named" },
      { key: "frontend:notes", listedAs: "frontend:notes" },
      { key: "migrate", listedAs: undefined },
      { key: "plain", listedAs: "plain" },
      release,
      ship,
    ]);
  });

  it("takes a skill at the top over a nested one of the same name", () => {
    expect(
      projectSkillsFrom([
        file("apps/web/.claude/skills/deploy/SKILL.md"),
        file(".claude/skills/deploy/SKILL.md"),
        file("apps/api/.claude/skills/deploy/SKILL.md"),
      ]),
    ).toEqual([{ key: "deploy", listedAs: "deploy" }]);
  });
});

describe("sessionSkillRecord", () => {
  const projectSkills = [deploy, release, reviewSkill, ship];

  it("allows the Project's skills when the Project uses them, expecting those at the top", () => {
    const record = sessionSkillRecord("s-1", [review], projectSkills, true, preparedAt);

    expect(record).toEqual({
      sessionId: "s-1",
      skills: [review],
      projectSkills,
      projectSkillsOff: [],
      preparedAt,
    });
    expect(allowedSkillNames(record)).toEqual([
      "office:review",
      "deploy",
      "release",
      "review",
      "ship",
    ]);
    expect(expectedSkillNames(record)).toEqual(["deploy", "office:review", "review", "ship"]);
    expect(skillOverridesOf(record)).toEqual({});
  });

  it("turns each of the Project's skills and commands off when the Project doesn't use them", () => {
    const record = sessionSkillRecord("s-1", [review], projectSkills, false, preparedAt);

    expect(allowedSkillNames(record)).toEqual(["office:review"]);
    expect(expectedSkillNames(record)).toEqual(["office:review"]);
    expect(skillOverridesOf(record)).toEqual({
      deploy: "off",
      release: "off",
      review: "off",
      ship: "off",
    });
  });

  it("has no Project skills for a session outside a Project", () => {
    const record = sessionSkillRecord("s-1", [review], [], true, preparedAt);

    expect(allowedSkillNames(record)).toEqual(["office:review"]);
    expect(skillOverridesOf(record)).toEqual({});
  });
});

describe("suffixMatches", () => {
  it("reports an allowed Project skill named as one of the session's library skills", () => {
    expect(
      suffixMatches(sessionSkillRecord("s-1", [review], [deploy, reviewSkill], true, preparedAt)),
    ).toEqual([
      "The Project's skill review also allows the library's office:review, which this session has too.",
    ]);
  });

  it("reports nothing when the Project's skills are off", () => {
    expect(
      suffixMatches(sessionSkillRecord("s-1", [review], [reviewSkill], false, preparedAt)),
    ).toEqual([]);
  });
});
