import { describe, expect, it } from "vitest";
import { aSkillFile } from "./skill.fixtures.js";
import { skillFilePathProblem, skillFilesHash, skillFilesProblems } from "./skill-files.js";

describe("skillFilesHash", () => {
  const files = [
    aSkillFile("SKILL.md", "---\nname: tdd\n---\n"),
    aSkillFile("scripts/run.sh", "x"),
  ];

  it("is the same on every system for the same files", () => {
    // Pinned: a change in how paths or bytes are read on one system fails here first.
    expect(skillFilesHash(files)).toBe(
      "1d11592f7d5c66c88eb1604e1aaf3925ab72adef4440f4bdd60909ee86480ca7",
    );
  });

  it("doesn't depend on the order the files come in", () => {
    expect(skillFilesHash(files.toReversed())).toBe(skillFilesHash(files));
  });

  it("changes with a line ending", () => {
    const windowsEndings = [aSkillFile("SKILL.md", "---\r\nname: tdd\r\n---\r\n"), files[1]!];

    expect(skillFilesHash(windowsEndings)).not.toBe(skillFilesHash(files));
  });

  it("tells a path from the contents that follow it", () => {
    const first = [aSkillFile("a", "bc")];
    const second = [aSkillFile("ab", "c")];

    expect(skillFilesHash(first)).not.toBe(skillFilesHash(second));
  });
});

describe("skillFilePathProblem", () => {
  it.each(["SKILL.md", "scripts/run.sh", "docs/a b/notes.md", ".hidden/x"])("passes %s", (path) => {
    expect(skillFilePathProblem(path)).toBeUndefined();
  });

  it.each(["notes:b.md", "what?.md", "notes.", "notes ", "tab\there", "aux.md", "scripts/CON.sh"])(
    "refuses %j, which Windows can't name",
    (path) => {
      expect(skillFilePathProblem(path)).toBe(`"${path}" can't be a file name on Windows.`);
    },
  );
});

describe("skillFilesProblems", () => {
  it("passes a SKILL.md and its supporting files", () => {
    expect(
      skillFilesProblems([aSkillFile("SKILL.md", ""), aSkillFile("scripts/run.sh", "")]),
    ).toEqual([]);
  });

  it("asks for a SKILL.md at the top", () => {
    expect(skillFilesProblems([aSkillFile("docs/SKILL.md", "")])).toEqual([
      "A skill has a SKILL.md at the top of its folder.",
    ]);
  });

  it("refuses two paths that are one file on Windows", () => {
    expect(skillFilesProblems([aSkillFile("SKILL.md", ""), aSkillFile("skill.md", "")])).toEqual([
      "Two of the skill's files have the same path, ignoring case.",
    ]);
  });

  it("refuses a path that is also a folder", () => {
    expect(
      skillFilesProblems([
        aSkillFile("SKILL.md", ""),
        aSkillFile("docs", ""),
        aSkillFile("docs/a.md", ""),
      ]),
    ).toEqual(['"docs" is both a file and a folder.']);
  });
});
