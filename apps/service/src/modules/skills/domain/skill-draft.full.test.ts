import { describe, expect, it } from "vitest";
import { aSkillFile } from "./skill.fixtures.js";
import { checkSameSkill, nameFromFileName, uploadedDraft, writtenDraft } from "./skill-draft.js";
import { readSkillMd } from "./skill-md.js";
import { SkillRefused } from "./skill-refused.js";

const skillMd = (frontmatter: string) => aSkillFile("SKILL.md", `---\n${frontmatter}\n---\nRed.\n`);

describe("writtenDraft", () => {
  it("writes one SKILL.md naming and describing the skill", () => {
    const draft = writtenDraft({
      name: " tdd ",
      description: " Test first. ",
      instructions: "Red, green.",
    });

    expect(draft.skill).toEqual({ name: "tdd", description: "Test first.", source: "written" });
    expect(draft.files.map((file) => file.path)).toEqual(["SKILL.md"]);
    expect(readSkillMd(new TextDecoder().decode(draft.files[0]!.content))).toEqual({
      frontmatter: { name: "tdd", description: "Test first." },
      instructions: "Red, green.",
    });
  });

  it("refuses with every reason", () => {
    expect(() => writtenDraft({ name: "", description: "", instructions: " " })).toThrow(
      new SkillRefused([
        "Give the skill a name.",
        "Give the skill a description: when to use it, in one sentence.",
        "Give the skill its instructions.",
      ]),
    );
  });
});

describe("uploadedDraft", () => {
  it("takes the name and description from SKILL.md", () => {
    const files = [skillMd("name: tdd\ndescription: >\n  Test\n  first.")];

    expect(uploadedDraft("upload", "uploaded-file", files)).toEqual({
      skill: { name: "tdd", description: "Test first.", source: "uploaded-file" },
      files,
    });
  });

  it("is named after its file or folder when SKILL.md names nothing", () => {
    const draft = uploadedDraft("release-notes", "uploaded-folder", [
      skillMd("description: Notes."),
    ]);

    expect(draft.skill.name).toBe("release-notes");
  });

  it("refuses a SKILL.md without a description", () => {
    expect(() => uploadedDraft("tdd", "uploaded-file", [skillMd("name: tdd")])).toThrow(
      new SkillRefused([
        "SKILL.md's frontmatter gives no description: when to use it, in one sentence.",
      ]),
    );
  });

  it("says when the bad name is SKILL.md's", () => {
    expect(() =>
      uploadedDraft("upload", "uploaded-file", [skillMd("name: Release Notes\ndescription: x")]),
    ).toThrow(
      new SkillRefused([
        `SKILL.md's frontmatter names it "Release Notes": A skill's name is lowercase letters and digits in words joined by dashes, such as release-notes.`,
      ]),
    );
  });

  it("refuses files that are no skill's, with every reason", () => {
    expect(() =>
      uploadedDraft("tdd", "uploaded-folder", [
        aSkillFile("README.md", ""),
        aSkillFile("../x", ""),
      ]),
    ).toThrow(
      new SkillRefused([
        `A skill's files stay inside its folder; "../x" is not inside.`,
        "A skill has a SKILL.md at the top of its folder.",
      ]),
    );
  });

  it("refuses a SKILL.md that is no UTF-8 text", () => {
    const binary = { path: "SKILL.md", content: new Uint8Array([0xff, 0xfe, 0x00]) };

    expect(() => uploadedDraft("tdd", "uploaded-file", [binary])).toThrow(
      new SkillRefused(["SKILL.md is not UTF-8 text."]),
    );
  });
});

describe("checkSameSkill", () => {
  it("refuses a version that names another skill", () => {
    const draft = uploadedDraft("x", "uploaded-file", [skillMd("name: other\ndescription: x")]);

    expect(() => checkSameSkill(draft, "tdd")).toThrow(
      new SkillRefused(["It names the skill other, not tdd."]),
    );
  });
});

describe("nameFromFileName", () => {
  it.each([
    ["release-notes.md", "release-notes"],
    ["Release Notes.zip", "release-notes"],
    ["Ćwiczenia_v2", "cwiczenia-v2"],
  ])("names %s %s", (fileName, name) => {
    expect(nameFromFileName(fileName)).toBe(name);
  });
});
