import { describe, expect, it } from "vitest";
import { readSkillMd, writtenSkillMd } from "./skill-md.js";

describe("readSkillMd", () => {
  it("reads the frontmatter and the instructions after it", () => {
    expect(readSkillMd("---\nname: tdd\ndescription: Test first.\n---\n\nRed, green.\n")).toEqual({
      frontmatter: { name: "tdd", description: "Test first." },
      instructions: "Red, green.",
    });
  });

  it("reads Windows line endings and a byte order mark", () => {
    expect(readSkillMd("﻿---\r\nname: tdd\r\n---\r\nRed.\r\n")).toEqual({
      frontmatter: { name: "tdd" },
      instructions: "Red.",
    });
  });

  it("reads a SKILL.md without frontmatter as instructions alone", () => {
    expect(readSkillMd("Red, green.\n")).toEqual({ frontmatter: {}, instructions: "Red, green." });
  });

  it("refuses frontmatter that is never closed", () => {
    expect(readSkillMd("---\nname: tdd\n")).toBe(
      "SKILL.md opens its frontmatter with --- but never closes it.",
    );
  });

  it("reads a plain value holding ': ' as the engine does, as the text after the first ': '", () => {
    expect(
      readSkillMd("---\nname: tdd\ndescription: Test first: red, green.\nversion: 2\n---\nRed.\n"),
    ).toEqual({
      frontmatter: { name: "tdd", description: "Test first: red, green.", version: 2 },
      instructions: "Red.",
    });
  });

  it("refuses frontmatter that is no YAML", () => {
    expect(readSkillMd("---\nname: [tdd\n---\n")).toMatch(/^SKILL\.md's frontmatter is not YAML: /);
  });

  it("refuses frontmatter with a YAML alias, which the engine refuses too", () => {
    expect(readSkillMd("---\na: &x 1\nb: *x\n---\n")).toMatch(
      /^SKILL\.md's frontmatter is not YAML/,
    );
  });

  it("refuses frontmatter that is a list", () => {
    expect(readSkillMd("---\n- tdd\n---\n")).toBe(
      "SKILL.md's frontmatter is a list or a single value, not keys and values.",
    );
  });
});

describe("writtenSkillMd", () => {
  it("reads back as written, whatever the description holds", () => {
    const description = `Use it: when a "quote", a # or > starts — or ends with a colon:`;

    const text = writtenSkillMd("tdd", description, "  Red, green.\n\n");

    expect(readSkillMd(text)).toEqual({
      frontmatter: { name: "tdd", description },
      instructions: "Red, green.",
    });
  });
});
