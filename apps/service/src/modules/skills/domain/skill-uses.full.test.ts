import { describe, expect, it } from "vitest";
import type { SessionSkillRecord } from "./session-skills.js";
import { skillUseWindowStart, usedSkillOf } from "./skill-uses.js";

const record: SessionSkillRecord = {
  sessionId: "s-1",
  skills: [
    { name: "tdd", version: 1, filesHash: "a".repeat(64) },
    { name: "review", version: 2, filesHash: "b".repeat(64) },
  ],
  projectId: "admin-panel",
  projectSkills: [
    { key: "lint-all", listedAs: "lint" },
    { key: "ops:deploy", listedAs: "ops:deploy" },
    { key: "review", listedAs: "review" },
    { key: "migrate", listedAs: undefined },
  ],
  projectSkillsOff: ["ship"],
  preparedAt: new Date("2026-11-10T09:00:00.000Z"),
};

const project = (key: string) => ({ kind: "project", projectId: "admin-panel", key });

describe("usedSkillOf", () => {
  it("counts office:<name> for the library skill the session got", () => {
    expect(usedSkillOf(record, "office:review")).toEqual({ kind: "library", skillName: "review" });
  });

  it("counts a bare name the session lists only as a library skill for that skill", () => {
    expect(usedSkillOf(record, "tdd")).toEqual({ kind: "library", skillName: "tdd" });
  });

  it("counts a Project skill's key, or the name it is listed as, for that Project's skill", () => {
    expect(usedSkillOf(record, "lint-all")).toEqual(project("lint-all"));
    expect(usedSkillOf(record, "lint")).toEqual(project("lint-all"));
    expect(usedSkillOf(record, "ops:deploy")).toEqual(project("ops:deploy"));
    expect(usedSkillOf(record, "migrate")).toEqual(project("migrate"));
    // The bare name of both: the engine takes it for the Project's.
    expect(usedSkillOf(record, "review")).toEqual(project("review"));
  });

  it("counts nothing for a name the session didn't get from The Office", () => {
    expect(usedSkillOf(record, "office:ship")).toBeUndefined();
    expect(usedSkillOf(record, "ship")).toBeUndefined();
    expect(usedSkillOf(record, "init")).toBeUndefined();
    expect(usedSkillOf(record, "plugin:tdd")).toBeUndefined();
  });

  it("counts no Project skill for a session outside a Project", () => {
    expect(usedSkillOf({ ...record, projectId: undefined }, "lint")).toBeUndefined();
  });
});

describe("skillUseWindowStart", () => {
  it("is 7 days before now", () => {
    expect(skillUseWindowStart(new Date("2026-11-10T12:00:00.000Z"))).toEqual(
      new Date("2026-11-03T12:00:00.000Z"),
    );
  });
});
