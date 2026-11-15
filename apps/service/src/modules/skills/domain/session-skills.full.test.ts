import { describe, expect, it } from "vitest";
import { aSkill } from "./skill.fixtures.js";
import {
  allowedSkillNames,
  expectedSkillNames,
  librarySkillsFor,
  projectSkillNamesFrom,
  sessionSkillRecord,
  skillOverridesOf,
  suffixMatches,
  userOnlySkillNames,
  type ProjectSkillName,
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
const deploy: ProjectSkillName = { key: "deploy", listedAs: "deploy" };
const reviewSkill: ProjectSkillName = { key: "review", listedAs: "review" };
const ship: ProjectSkillName = { key: "ship", listedAs: "ship" };
const release: ProjectSkillName = { key: "release", listedAs: undefined };

describe("projectSkillNamesFrom", () => {
  it("names skills and commands as the engine lists them, nested ones only later", () => {
    expect(
      projectSkillNamesFrom([
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
      projectSkillNamesFrom([
        file("apps/web/.claude/skills/deploy/SKILL.md"),
        file(".claude/skills/deploy/SKILL.md"),
        file("apps/api/.claude/skills/deploy/SKILL.md"),
      ]),
    ).toEqual([{ key: "deploy", listedAs: "deploy" }]);
  });

  it("flags a skill or command at the top that only the user runs, not a nested one", () => {
    const userOnly = "---\ndisable-model-invocation: true\n---\nShip it.\n";
    expect(
      projectSkillNamesFrom([
        file(".claude/skills/deploy/SKILL.md", userOnly),
        file(".claude/commands/ship.md", userOnly),
        file("apps/web/.claude/skills/release/SKILL.md", userOnly),
        file(".claude/skills/plain/SKILL.md", "---\ndisable-model-invocation: false\n---\n"),
      ]),
    ).toEqual([
      { key: "deploy", listedAs: "deploy", userOnly: true },
      { key: "plain", listedAs: "plain" },
      release,
      { key: "ship", listedAs: "ship", userOnly: true },
    ]);
  });
});

const allOn = { useProjectSkills: true, projectSkillsOff: [] };
const allOff = { useProjectSkills: false, projectSkillsOff: [] };

describe("sessionSkillRecord", () => {
  const projectSkills = [deploy, release, reviewSkill, ship];

  it("allows the Project's skills when the Project uses them, expecting those at the top", () => {
    const record = sessionSkillRecord(
      "s-1",
      [review],
      "admin-panel",
      projectSkills,
      allOn,
      preparedAt,
    );

    expect(record).toEqual({
      sessionId: "s-1",
      skills: [review],
      projectId: "admin-panel",
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
    const record = sessionSkillRecord(
      "s-1",
      [review],
      "admin-panel",
      projectSkills,
      allOff,
      preparedAt,
    );

    expect(allowedSkillNames(record)).toEqual(["office:review"]);
    expect(expectedSkillNames(record)).toEqual(["office:review"]);
    expect(skillOverridesOf(record)).toEqual({
      deploy: "off",
      release: "off",
      review: "off",
      ship: "off",
    });
  });

  it("splits the Project's skills by what the Project turned off", () => {
    const record = sessionSkillRecord(
      "s-1",
      [],
      "admin-panel",
      projectSkills,
      { useProjectSkills: true, projectSkillsOff: ["deploy", "release"] },
      preparedAt,
    );

    expect(allowedSkillNames(record)).toEqual(["review", "ship"]);
    expect(expectedSkillNames(record)).toEqual(["review", "ship"]);
    expect(skillOverridesOf(record)).toEqual({ deploy: "off", release: "off" });
  });

  it("gets none of them with every skill turned off one by one", () => {
    const record = sessionSkillRecord(
      "s-1",
      [],
      "admin-panel",
      [deploy, ship],
      { useProjectSkills: true, projectSkillsOff: ["deploy", "ship"] },
      preparedAt,
    );

    expect(allowedSkillNames(record)).toEqual([]);
    expect(skillOverridesOf(record)).toEqual({ deploy: "off", ship: "off" });
  });

  it("keeps the library's skill of a name the Project turned off", () => {
    const record = sessionSkillRecord(
      "s-1",
      [review],
      "admin-panel",
      [reviewSkill],
      { useProjectSkills: true, projectSkillsOff: ["review"] },
      preparedAt,
    );

    expect(allowedSkillNames(record)).toEqual(["office:review"]);
    expect(expectedSkillNames(record)).toEqual(["office:review"]);
    expect(suffixMatches(record)).toEqual([]);
  });

  it("leaves out an off key the repository no longer holds, and starts a new skill on", () => {
    const record = sessionSkillRecord(
      "s-1",
      [],
      "admin-panel",
      [deploy],
      { useProjectSkills: true, projectSkillsOff: ["removed"] },
      preparedAt,
    );

    expect(allowedSkillNames(record)).toEqual(["deploy"]);
    expect(skillOverridesOf(record)).toEqual({});
  });

  it("has no Project skills for a session outside a Project", () => {
    const record = sessionSkillRecord("s-1", [review], undefined, [], allOn, preparedAt);

    expect(allowedSkillNames(record)).toEqual(["office:review"]);
    expect(skillOverridesOf(record)).toEqual({});
  });
});

describe("userOnlySkillNames", () => {
  it("names the library's and the Project's skills only the user runs, which aren't expected", () => {
    const tdd: SessionSkill = { name: "tdd", version: 1, filesHash: "c".repeat(64) };
    const record = sessionSkillRecord(
      "s-1",
      [review, tdd],
      "admin-panel",
      [{ ...deploy, userOnly: true }, ship],
      allOn,
      preparedAt,
    );

    expect(userOnlySkillNames(record, new Set(["tdd"]))).toEqual(["deploy", "office:tdd"]);
    expect(expectedSkillNames(record, new Set(["tdd"]))).toEqual(["office:review", "ship"]);
    expect(allowedSkillNames(record)).toEqual(["office:review", "office:tdd", "deploy", "ship"]);
  });

  it("names none the Project turned off", () => {
    const record = sessionSkillRecord(
      "s-1",
      [],
      "admin-panel",
      [{ ...deploy, userOnly: true }],
      allOff,
      preparedAt,
    );

    expect(userOnlySkillNames(record, new Set())).toEqual([]);
  });
});

describe("suffixMatches", () => {
  it("reports an allowed Project skill named as one of the session's library skills", () => {
    expect(
      suffixMatches(
        sessionSkillRecord(
          "s-1",
          [review],
          "admin-panel",
          [deploy, reviewSkill],
          allOn,
          preparedAt,
        ),
      ),
    ).toEqual([
      "The Project's skill review also allows the library's office:review, which this session has too.",
    ]);
  });

  it("reports nothing when the Project's skills are off", () => {
    expect(
      suffixMatches(
        sessionSkillRecord("s-1", [review], "admin-panel", [reviewSkill], allOff, preparedAt),
      ),
    ).toEqual([]);
  });
});
