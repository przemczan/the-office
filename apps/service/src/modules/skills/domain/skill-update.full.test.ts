import { describe, expect, it } from "vitest";
import { aSkill } from "./skill.fixtures.js";
import { applyUpdate } from "./skill-changes.js";
import { SkillUpdated } from "./skill-events.js";
import { SkillRefused } from "./skill-refused.js";
import { cutDiff, updateProblem } from "./skill-update.js";

const v1 = { tag: "v1", commit: "a" };
const v2 = { tag: "v2", commit: "b" };
const at = new Date("2026-10-28T10:00:00.000Z");

const installedFrom = { repository: "acme/skills", folder: "notes", pinnedVersion: v1 };
const installed = aSkill({
  source: "installed",
  installedFrom,
  state: "on",
  update: v2,
});

describe("updateProblem", () => {
  it("has none for an update from the skill's pinned version", () => {
    expect(updateProblem(installed, { name: installed.name, from: v1, to: v2 })).toBeUndefined();
  });

  it("refuses a stale update, proposed from another pinned version", () => {
    const pinnedAtV2 = { ...installed, installedFrom: { ...installedFrom, pinnedVersion: v2 } };
    expect(updateProblem(pinnedAtV2, { name: installed.name, from: v1, to: v2 })).toBe(
      `${installed.name} is pinned at v2 now, not at v1 as this update was proposed from.`,
    );
  });

  it("refuses a skill that wasn't installed", () => {
    expect(updateProblem(aSkill(), { name: "notes", from: v1, to: v2 })).toMatch(/has no updates/);
  });
});

describe("applyUpdate", () => {
  const update = { name: installed.name, from: v1, to: v2 };

  it("pins the skill at the update with its next version, on as it was, the update cleared", () => {
    const { skill, event } = applyUpdate(
      installed,
      update,
      { description: "Notes, twice.", filesHash: "b".repeat(64) },
      at,
    );

    expect(skill).toEqual({
      ...installed,
      update: undefined,
      installedFrom: { ...installedFrom, pinnedVersion: v2 },
      description: "Notes, twice.",
      version: 2,
      filesHash: "b".repeat(64),
      savedAt: at,
      state: "on",
    });
    expect(skill).not.toHaveProperty("update");
    expect(event).toBeInstanceOf(SkillUpdated);
  });

  it("keeps the version when the files are the same, and a newer update noted", () => {
    const v3 = { tag: "v3", commit: "c" };
    const { skill } = applyUpdate(
      { ...installed, update: v3 },
      update,
      { description: "Other.", filesHash: installed.filesHash },
      at,
    );

    expect(skill).toMatchObject({ version: 1, description: installed.description, update: v3 });
    expect(skill.installedFrom?.pinnedVersion).toEqual(v2);
  });

  it("refuses a stale update", () => {
    expect(() =>
      applyUpdate(installed, { ...update, from: v2 }, { description: "", filesHash: "" }, at),
    ).toThrow(SkillRefused);
  });
});

describe("cutDiff", () => {
  it("keeps a diff within the limit whole", () => {
    expect(cutDiff("-a\n+b\n", 100)).toEqual({ diff: "-a\n+b\n", diffCut: false });
  });

  it("cuts a longer one at its last whole line", () => {
    expect(cutDiff("-a\n+b\n+c\n", 7)).toEqual({ diff: "-a\n+b\n", diffCut: true });
  });
});
