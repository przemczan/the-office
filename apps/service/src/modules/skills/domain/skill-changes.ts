import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { isUpdateOf, samePinnedVersion, type PinnedVersion } from "./installed-source.js";
import { noUpdates, updateProblem, type ProposedUpdate } from "./skill-update.js";
import {
  newSkillProblems,
  skillDescriptionProblems,
  trimmedNewSkill,
  type NewSkill,
  type Skill,
} from "./skill.js";
import {
  SkillAdded,
  SkillEveryoneChanged,
  SkillRemoved,
  SkillTurnedOff,
  SkillTurnedOn,
  SkillUpdateFound,
  SkillUpdateGone,
  SkillUpdated,
  SkillVersionSaved,
} from "./skill-events.js";
import { SkillRefused } from "./skill-refused.js";

/** A skill after a change, with the event that announces it. */
export interface SkillChange<Event extends DomainEvent> {
  readonly skill: Skill;
  readonly event: Event;
}

/**
 * Its first version, waiting for review. That `filesHash` is of files that follow the rules is
 * for the caller to know.
 */
export function addSkill(
  given: NewSkill,
  filesHash: string,
  addedAt: Date,
): SkillChange<SkillAdded> {
  const newSkill = trimmedNewSkill(given);
  const problems = newSkillProblems(newSkill);
  if (problems.length > 0) throw new SkillRefused(problems);
  const skill: Skill = {
    ...newSkill,
    version: 1,
    filesHash,
    state: "waiting-for-review",
    everyone: false,
    addedAt,
    savedAt: addedAt,
  };
  return { skill, event: new SkillAdded(skill) };
}

/**
 * The next version, waiting for review whatever the state was (spec §9). Undefined when the
 * files are the current version's: the description is in them, so it is unchanged too.
 */
export function saveVersion(
  skill: Skill,
  description: string,
  filesHash: string,
  savedAt: Date,
): SkillChange<SkillVersionSaved> | undefined {
  const trimmed = description.trim();
  const problems = skillDescriptionProblems(trimmed);
  if (problems.length > 0) throw new SkillRefused(problems);
  if (skill.filesHash === filesHash) return undefined;
  const saved: Skill = {
    ...skill,
    description: trimmed,
    version: skill.version + 1,
    filesHash,
    state: "waiting-for-review",
    savedAt,
  };
  return { skill: saved, event: new SkillVersionSaved(saved) };
}

/**
 * Notes what the daily check found its Source pinned at now (spec §2.6): an update when it is
 * newer than the skill's pinned version, none otherwise. Undefined when that is what the skill
 * already notes, or it wasn't installed.
 */
export function noteSourceVersion(
  skill: Skill,
  now: PinnedVersion,
): SkillChange<SkillUpdateFound | SkillUpdateGone> | undefined {
  if (!skill.installedFrom) return undefined;
  const { update: noted, ...withoutUpdate } = skill;
  if (isUpdateOf(now, skill.installedFrom.pinnedVersion)) {
    if (noted && samePinnedVersion(noted, now)) return undefined;
    return { skill: { ...skill, update: now }, event: new SkillUpdateFound(skill.name, now) };
  }
  if (!noted) return undefined;
  return { skill: withoutUpdate, event: new SkillUpdateGone(skill.name) };
}

/**
 * Pins the skill at its update's version with the files fetched there (spec §2.6): applying the
 * update is its review, so the skill stays on or off as it was. A new version only when the files
 * changed; the noted update stays only when it is newer still. Refuses a stale update.
 */
export function applyUpdate(
  skill: Skill,
  update: ProposedUpdate,
  fetched: { readonly description: string; readonly filesHash: string },
  savedAt: Date,
): SkillChange<SkillUpdated> {
  const { installedFrom, update: noted, ...withoutUpdate } = skill;
  if (!installedFrom) throw new SkillRefused([noUpdates(skill.name)]);
  const problem = updateProblem(skill, update);
  if (problem !== undefined) throw new SkillRefused([problem]);
  const filesChanged = fetched.filesHash !== skill.filesHash;
  const updated: Skill = {
    ...withoutUpdate,
    installedFrom: { ...installedFrom, pinnedVersion: update.to },
    ...(noted && isUpdateOf(noted, update.to) && { update: noted }),
    ...(filesChanged && {
      description: fetched.description,
      version: skill.version + 1,
      filesHash: fetched.filesHash,
      savedAt,
    }),
  };
  return { skill: updated, event: new SkillUpdated(updated) };
}

/** Turning a skill on is its review. Undefined when it is already on. */
export function turnOn(skill: Skill): SkillChange<SkillTurnedOn> | undefined {
  if (skill.state === "on") return undefined;
  return {
    skill: { ...skill, state: "on" },
    event: new SkillTurnedOn(skill.name, skill.version),
  };
}

/** Undefined when it is already off, waiting for review or not. */
export function turnOff(skill: Skill): SkillChange<SkillTurnedOff> | undefined {
  if (skill.state !== "on") return undefined;
  return { skill: { ...skill, state: "off" }, event: new SkillTurnedOff(skill.name) };
}

/** Undefined when it already is, or isn't, for everyone. */
export function changeEveryone(
  skill: Skill,
  everyone: boolean,
): SkillChange<SkillEveryoneChanged> | undefined {
  if (skill.everyone === everyone) return undefined;
  return {
    skill: { ...skill, everyone },
    event: new SkillEveryoneChanged(skill.name, everyone),
  };
}

/** Its files stay in the library while a session that got them can be resumed. */
export function removeSkill(skill: Skill): SkillRemoved {
  return new SkillRemoved(skill.name);
}
