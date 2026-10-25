import { describe, expect, it } from "vitest";
import { newSkillProblems, skillDescriptionProblems, skillNameProblems } from "./skill.js";
import { aNewSkill } from "./skill.fixtures.js";

describe("skillNameProblems", () => {
  it.each(["tdd", "release-notes", "a2a", "x".repeat(64)])("passes %s", (name) => {
    expect(skillNameProblems(name)).toEqual([]);
  });

  it("asks for a name", () => {
    expect(skillNameProblems("")).toEqual(["Give the skill a name."]);
  });

  it.each(["Release", "release_notes", "-release", "release-", "release--notes", "office:tdd"])(
    "refuses %s, which is no lowercase words joined by dashes",
    (name) => {
      expect(skillNameProblems(name)).toEqual([
        "A skill's name is lowercase letters and digits in words joined by dashes, such as release-notes.",
      ]);
    },
  );

  it("refuses a name longer than 64 characters", () => {
    expect(skillNameProblems("x".repeat(65))).toEqual([
      "A skill's name may be at most 64 characters.",
    ]);
  });

  it.each(["con", "nul", "aux", "prn", "com1", "lpt9"])(
    "refuses %s, which can't name a folder on Windows",
    (name) => {
      expect(skillNameProblems(name)).toEqual([
        `"${name}" is a name Windows keeps for a device; choose another.`,
      ]);
    },
  );
});

describe("skillDescriptionProblems", () => {
  it("passes one short line", () => {
    expect(skillDescriptionProblems(aNewSkill().description)).toEqual([]);
  });

  it("asks for a description", () => {
    expect(skillDescriptionProblems("")).toEqual([
      "Give the skill a description: when to use it, in one sentence.",
    ]);
  });

  it("refuses more than one line and more than 200 characters at once", () => {
    expect(skillDescriptionProblems(`${"x".repeat(200)}\nmore`)).toEqual([
      "A skill's description must be one line.",
      "A skill's description may be at most 200 characters: every session that has it lists it.",
    ]);
  });
});

describe("newSkillProblems", () => {
  it("lists the name's and the description's problems together", () => {
    expect(newSkillProblems(aNewSkill({ name: "", description: "" }))).toEqual([
      "Give the skill a name.",
      "Give the skill a description: when to use it, in one sentence.",
    ]);
  });
});
