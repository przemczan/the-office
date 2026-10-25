import type { Skill } from "./skill.js";

/**
 * One saved version of a skill. Its files stay in the library while a session that got them
 * can be resumed, since the session's folder is rebuilt from them (spec §5.6).
 */
export interface SkillVersion {
  readonly skillName: string;
  readonly version: number;
  readonly filesHash: string;
  readonly description: string;
  readonly savedAt: Date;
}

export function currentVersionOf(skill: Skill): SkillVersion {
  return {
    skillName: skill.name,
    version: skill.version,
    filesHash: skill.filesHash,
    description: skill.description,
    savedAt: skill.savedAt,
  };
}
