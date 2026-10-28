import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aNewSkill, aSkill } from "./skill.fixtures.js";
import {
  addSkill,
  changeEveryone,
  noteSourceVersion,
  removeSkill,
  saveVersion,
  turnOff,
  turnOn,
} from "./skill-changes.js";
import {
  SkillAdded,
  SkillEveryoneChanged,
  SkillRemoved,
  SkillTurnedOff,
  SkillTurnedOn,
  SkillUpdateFound,
  SkillUpdateGone,
  SkillVersionSaved,
} from "./skill-events.js";
import { SkillRefused } from "./skill-refused.js";

const at = new Date("2026-10-25T10:00:00.000Z");

/** An event of `type` with `fields`, whenever it occurred. */
function anEvent<Event extends object>(
  type: new (...args: never[]) => Event,
  fields: Partial<Event>,
): Event {
  return Object.assign(Object.create(type.prototype) as Event, {
    ...fields,
    occurredAt: expect.any(Date),
  });
}

const otherHash = "b".repeat(64);

describe("addSkill", () => {
  it("adds version 1, waiting for review and for nobody yet", () => {
    const { skill, event } = addSkill(
      aNewSkill({ name: " tdd ", description: " Test first. " }),
      otherHash,
      at,
    );

    expect(skill).toEqual({
      name: "tdd",
      description: "Test first.",
      source: "written",
      version: 1,
      filesHash: otherHash,
      state: "waiting-for-review",
      everyone: false,
      addedAt: at,
      savedAt: at,
    });
    expect(event).toEqual(new SkillAdded(skill));
  });

  it("refuses with every reason", () => {
    expect(() => addSkill(aNewSkill({ name: "", description: "" }), otherHash, at)).toThrow(
      new SkillRefused([
        "Give the skill a name.",
        "Give the skill a description: when to use it, in one sentence.",
      ]),
    );
  });
});

describe("saveVersion", () => {
  it("makes the next version and sends an on skill back to review", () => {
    const skill = aSkill({ state: "on", everyone: true });

    const saved = saveVersion(skill, "Writes the release notes.", otherHash, at);

    expect(saved?.skill).toEqual({
      ...skill,
      description: "Writes the release notes.",
      version: 2,
      filesHash: otherHash,
      state: "waiting-for-review",
      savedAt: at,
    });
    expect(saved?.event).toEqual(new SkillVersionSaved(saved!.skill));
  });

  it("changes nothing when the files are the current version's", () => {
    const skill = aSkill({ state: "on" });

    expect(saveVersion(skill, skill.description, skill.filesHash, at)).toBeUndefined();
  });

  it("refuses a description that breaks the rules", () => {
    expect(() => saveVersion(aSkill(), "", otherHash, at)).toThrow(SkillRefused);
  });
});

describe("turnOn", () => {
  it.each(["waiting-for-review", "off"] as const)("turns on a skill that is %s", (state) => {
    const skill = aSkill({ state, version: 3 });

    expect(turnOn(skill)).toEqual({
      skill: { ...skill, state: "on" },
      event: anEvent(SkillTurnedOn, { skillName: skill.name, version: 3 }),
    });
  });

  it("changes nothing for a skill already on", () => {
    expect(turnOn(aSkill({ state: "on" }))).toBeUndefined();
  });
});

describe("turnOff", () => {
  it("turns off a skill that is on", () => {
    const skill = aSkill({ state: "on" });

    expect(turnOff(skill)).toEqual({
      skill: { ...skill, state: "off" },
      event: anEvent(SkillTurnedOff, { skillName: skill.name }),
    });
  });

  it.each(["waiting-for-review", "off"] as const)("changes nothing for a skill %s", (state) => {
    expect(turnOff(aSkill({ state }))).toBeUndefined();
  });
});

describe("changeEveryone", () => {
  it("marks a skill for everyone", () => {
    const skill = aSkill();

    expect(changeEveryone(skill, true)).toEqual({
      skill: { ...skill, everyone: true },
      event: anEvent(SkillEveryoneChanged, { skillName: skill.name, everyone: true }),
    });
  });

  it("changes nothing when it already is", () => {
    expect(changeEveryone(aSkill({ everyone: true }), true)).toBeUndefined();
  });
});

describe("removeSkill", () => {
  it("announces the removal", () => {
    expect(removeSkill(aSkill())).toEqual(anEvent(SkillRemoved, { skillName: "release-notes" }));
  });
});

describe("noteSourceVersion", () => {
  const installed = aSkill({
    source: "installed",
    installedFrom: {
      repository: "acme/skills",
      folder: "notes",
      pinnedVersion: { tag: "v1", commit: "a" },
    },
  });
  const v2 = { tag: "v2", commit: "b" };

  // The expected event is made apart from the one noted: one clock reading for both.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-28T09:00:00Z") });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("notes a newer pinned version as the update, keeping the skill's state", () => {
    const skill = { ...installed, state: "on" as const };
    expect(noteSourceVersion(skill, v2)).toEqual({
      skill: { ...skill, update: v2 },
      event: new SkillUpdateFound(skill.name, v2),
    });
  });

  it("changes nothing when the update is already noted, or there is none", () => {
    expect(noteSourceVersion({ ...installed, update: v2 }, v2)).toBeUndefined();
    expect(noteSourceVersion(installed, { tag: "v1", commit: "a" })).toBeUndefined();
  });

  it("notes a newer update over the one noted before", () => {
    const v3 = { tag: "v3", commit: "c" };
    expect(noteSourceVersion({ ...installed, update: v2 }, v3)?.skill.update).toEqual(v3);
  });

  it("clears an update its Source no longer has", () => {
    expect(noteSourceVersion({ ...installed, update: v2 }, { tag: "v1", commit: "a" })).toEqual({
      skill: installed,
      event: new SkillUpdateGone(installed.name),
    });
  });

  it("notes nothing on a skill that wasn't installed", () => {
    expect(noteSourceVersion(aSkill(), v2)).toBeUndefined();
  });
});
