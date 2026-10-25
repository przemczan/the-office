import type { NewSkill, Skill } from "./skill.js";
import type { SkillFile } from "./skill-files.js";

export function aNewSkill(fields: Partial<NewSkill> = {}): NewSkill {
  return {
    name: "release-notes",
    description: "Writes the release notes from the merged pull requests since the last tag.",
    source: "written",
    ...fields,
  };
}

export function aSkill(fields: Partial<Skill> = {}): Skill {
  return {
    ...aNewSkill(),
    version: 1,
    filesHash: "a".repeat(64),
    state: "waiting-for-review",
    everyone: false,
    addedAt: new Date("2026-10-25T09:00:00.000Z"),
    savedAt: new Date("2026-10-25T09:00:00.000Z"),
    ...fields,
  };
}

/** A file of text, as a skill's files are kept. */
export function aSkillFile(path: string, text: string): SkillFile {
  return { path, content: new TextEncoder().encode(text) };
}
