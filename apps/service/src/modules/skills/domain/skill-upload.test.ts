import { describe, expect, it } from "vitest";
import { aSkillFile } from "./skill.fixtures.js";
import { SkillRefused } from "./skill-refused.js";
import { draftFromMd, draftFromZip, uploadKind, type ZipEntry } from "./skill-upload.js";

const text = (value: string) => new TextEncoder().encode(value);
const file = (path: string, value = ""): ZipEntry => ({ kind: "file", path, content: text(value) });
const SKILL_MD = "---\ndescription: Notes.\n---\nWrite them.\n";

describe("uploadKind", () => {
  it.each([
    ["notes.md", "md"],
    ["NOTES.MD", "md"],
    ["notes.zip", "zip"],
    ["notes.txt", undefined],
  ])("takes %s as %s", (fileName, kind) => {
    expect(uploadKind(fileName)).toBe(kind);
  });
});

describe("draftFromMd", () => {
  it("makes the file the skill's SKILL.md, named after the file", () => {
    expect(draftFromMd("release-notes.md", text(SKILL_MD))).toEqual({
      skill: { name: "release-notes", description: "Notes.", source: "uploaded-file" },
      files: [{ path: "SKILL.md", content: text(SKILL_MD) }],
    });
  });
});

describe("draftFromZip", () => {
  it("keeps the folder's files, named after the zip", () => {
    const draft = draftFromZip("release-notes.zip", [
      { kind: "folder", path: "scripts/" },
      file("SKILL.md", SKILL_MD),
      file("scripts/collect.sh", "#!/bin/sh\n"),
    ]);

    expect(draft.skill).toEqual({
      name: "release-notes",
      description: "Notes.",
      source: "uploaded-folder",
    });
    expect(draft.files).toEqual([
      aSkillFile("SKILL.md", SKILL_MD),
      aSkillFile("scripts/collect.sh", "#!/bin/sh\n"),
    ]);
  });

  it("takes the one folder around everything as the skill's, named after it", () => {
    const draft = draftFromZip("download.zip", [
      { kind: "folder", path: "release-notes/" },
      file("release-notes/SKILL.md", SKILL_MD),
      file("release-notes/docs/a.md"),
    ]);

    expect(draft.skill.name).toBe("release-notes");
    expect(draft.files.map((entry) => entry.path)).toEqual(["SKILL.md", "docs/a.md"]);
  });

  it("leaves out what macOS adds to a zip", () => {
    const draft = draftFromZip("notes.zip", [
      file("SKILL.md", SKILL_MD),
      file(".DS_Store"),
      file("__MACOSX/._SKILL.md"),
    ]);

    expect(draft.files.map((entry) => entry.path)).toEqual(["SKILL.md"]);
  });

  it("keeps names as one form of Unicode, whichever the zip used", () => {
    const decomposed = "notíce.md";

    const draft = draftFromZip("notes.zip", [file("SKILL.md", SKILL_MD), file(decomposed)]);

    expect(draft.files.map((entry) => entry.path)).toEqual(["SKILL.md", "notíce.md"]);
  });

  it("refuses links and anything else that is no file, with every one named", () => {
    expect(() =>
      draftFromZip("notes.zip", [
        file("SKILL.md", SKILL_MD),
        { kind: "link", path: "secrets" },
        { kind: "other", path: "pipe" },
      ]),
    ).toThrow(
      new SkillRefused([
        `"secrets" is a link; a skill holds only its own files.`,
        `"pipe" is not a regular file.`,
      ]),
    );
  });

  it("refuses a file outside the folder", () => {
    expect(() =>
      draftFromZip("notes.zip", [file("SKILL.md", SKILL_MD), file("../outside")]),
    ).toThrow(
      new SkillRefused([`A skill's files stay inside its folder; "../outside" is not inside.`]),
    );
  });

  it("refuses a zip with no files", () => {
    expect(() => draftFromZip("notes.zip", [{ kind: "folder", path: "a/" }])).toThrow(
      new SkillRefused(["The zip holds no files."]),
    );
  });
});
