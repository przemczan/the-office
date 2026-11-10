import { SESSION_PLUGIN, type SessionSkillRecord } from "./session-skills.js";

/** How far back a skill's uses are counted, and kept (spec §2.6). */
export const SKILL_USE_DAYS = 7;

/** The skill a Skill use counts for: a library skill by its name, a Project skill per Project. */
export type UsedSkill =
  | { readonly kind: "library"; readonly skillName: string }
  | { readonly kind: "project"; readonly projectId: string; readonly key: string };

/** One Skill tool call in a session, counted for the skill that session got under that name. */
export interface SkillUse {
  readonly sessionId: string;
  readonly skill: UsedSkill;
  readonly usedAt: Date;
}

const LIBRARY_PREFIX = `${SESSION_PLUGIN}:`;

/**
 * The skill a session got from The Office under `called`, the name its Skill call gave without a
 * leading `/`: a library skill by its plugin's name (`office:<name>`), else a Project skill by its
 * key or the name it is listed as, else a library skill by its bare name. Undefined for any other
 * name, such as an engine's built-in skill, which isn't counted.
 */
export function usedSkillOf(record: SessionSkillRecord, called: string): UsedSkill | undefined {
  const library = new Set(record.skills.map((skill) => skill.name));
  if (called.startsWith(LIBRARY_PREFIX)) {
    const skillName = called.slice(LIBRARY_PREFIX.length);
    return library.has(skillName) ? { kind: "library", skillName } : undefined;
  }
  const projectSkill =
    record.projectSkills.find((skill) => skill.key === called) ??
    record.projectSkills.find((skill) => skill.listedAs === called);
  if (projectSkill !== undefined) {
    // A record prepared before it kept its Project's id can't count it, and the engine still took
    // the name for the Project's skill, not a library skill of the same name.
    if (record.projectId === undefined) return undefined;
    return { kind: "project", projectId: record.projectId, key: projectSkill.key };
  }
  return library.has(called) ? { kind: "library", skillName: called } : undefined;
}

/** When a use stops counting: uses at or before it are outside the last 7 days. */
export function skillUseWindowStart(now: Date): Date {
  return new Date(now.getTime() - SKILL_USE_DAYS * 24 * 60 * 60 * 1000);
}
