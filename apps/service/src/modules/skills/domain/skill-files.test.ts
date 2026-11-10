import { describe, expect, it } from "vitest";
import { aSkillFile } from "./skill.fixtures.js";
import { skillFilePathProblem, skillFilesProblems } from "./skill-files.js";

describe("skillFilePathProblem", () => {
  it.each(["", "/etc/passwd", "../x", "a/../../x", "a//b", "./a", "a\\b", "C:/x"])(
    "refuses %j, which is not inside the folder",
    (path) => {
      expect(skillFilePathProblem(path)).toBe(
        `A skill's files stay inside its folder; "${path}" is not inside.`,
      );
    },
  );
});

describe("skillFilesProblems", () => {
  it("names every file that would leave the folder", () => {
    expect(
      skillFilesProblems([
        aSkillFile("SKILL.md", ""),
        aSkillFile("../a", ""),
        aSkillFile("/b", ""),
      ]),
    ).toEqual([
      `A skill's files stay inside its folder; "../a" is not inside.`,
      `A skill's files stay inside its folder; "/b" is not inside.`,
    ]);
  });
});
