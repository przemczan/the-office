import { describe, expect, it } from "vitest";
import type { InstalledSource } from "./installed-source.js";
import { SkillRefused } from "./skill-refused.js";
import { installedDraft } from "./source-skills.js";

const text = (value: string) => new TextEncoder().encode(value);
const SKILL_MD = "---\ndescription: Notes.\n---\nWrite them.\n";
const source: InstalledSource = {
  repository: "owner/skills",
  folder: "skills/release-notes",
  pinnedVersion: { tag: "v1.0", commit: "abc" },
};

describe("installedDraft", () => {
  it("is the folder's skill, named after the folder, with its Source", () => {
    const draft = installedDraft(source, {
      folder: source.folder,
      entries: [
        { kind: "file", path: "SKILL.md", content: text(SKILL_MD) },
        { kind: "file", path: "scripts/collect.sh", content: text("#!/bin/sh\n") },
      ],
    });

    expect(draft.skill).toEqual({
      name: "release-notes",
      description: "Notes.",
      source: "installed",
      installedFrom: source,
    });
    expect(draft.files.map((file) => file.path)).toEqual(["SKILL.md", "scripts/collect.sh"]);
  });

  it("refuses a folder over the limits", () => {
    expect(() => installedDraft(source, { folder: source.folder, tooLarge: true })).toThrow(
      '"skills/release-notes" holds more than a skill may: at most 500 files and 10 MB.',
    );
  });

  it("refuses links, and files the library refuses", () => {
    const refusal = (() => {
      try {
        installedDraft(source, {
          folder: source.folder,
          entries: [
            { kind: "file", path: "SKILL.md", content: text(SKILL_MD) },
            { kind: "link", path: "outside.md" },
          ],
        });
      } catch (error) {
        return error;
      }
      return undefined;
    })();

    expect(refusal).toBeInstanceOf(SkillRefused);
    expect((refusal as SkillRefused).reasons).toEqual([
      '"outside.md" is a link; a skill holds only its own files.',
    ]);
    expect(() =>
      installedDraft(source, {
        folder: source.folder,
        entries: [{ kind: "file", path: "README.md", content: text("Notes.") }],
      }),
    ).toThrow(SkillRefused);
  });
});
