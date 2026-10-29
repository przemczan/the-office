import type { InstalledSource, PinnedVersion } from "./installed-source.js";
import { isWindowsDeviceName } from "./skill-files.js";

/** How a skill came into the library. */
export const SKILL_SOURCES = ["written", "uploaded-file", "uploaded-folder", "installed"] as const;
export type SkillSource = (typeof SKILL_SOURCES)[number];

/**
 * Whether sessions get the skill. Every new version waits for review, and only the user's
 * review turns it on (spec §2.6, §9).
 */
export const SKILL_STATES = ["waiting-for-review", "on", "off"] as const;
export type SkillState = (typeof SKILL_STATES)[number];

/** A skill in The Office's library, at its current version. */
export interface Skill {
  /** The skill's folder in the library and in a session's plugin, so it is kept as given. */
  readonly name: string;
  /** What every session that has the skill lists, so it is short (spec §2.6). */
  readonly description: string;
  readonly source: SkillSource;
  /** Its Source and pinned version: there exactly when it was installed. */
  readonly installedFrom?: InstalledSource;
  /**
   * The newer pinned version the daily check found at its Source, shown as "Update available";
   * only an installed skill has one.
   */
  readonly update?: PinnedVersion;
  /** Counts the saved changes, from 1. */
  readonly version: number;
  /** The current version's files hash (`skillFilesHash`). */
  readonly filesHash: string;
  readonly state: SkillState;
  /** Comes with every Role, besides the skills a Role card names. */
  readonly everyone: boolean;
  readonly addedAt: Date;
  /** When the current version was saved. */
  readonly savedAt: Date;
}

/** What makes a new skill; the rest is set by The Office. */
export type NewSkill = Pick<Skill, "name" | "description" | "source" | "installedFrom">;

/** The engine's own limit on a skill's name. */
const NAME_LENGTH = 64;
/**
 * The engine's own limit on a listing entry: a longer description is cut there. The user accepted
 * the engine's limit so that published skills install as they are (spec §2.6).
 */
export const DESCRIPTION_LENGTH = 1_536;
/**
 * A session's listing gets about 1% of the context window, 8,000 characters at 200k; a description
 * over 500 takes more than a sixteenth of it, so Review flags it.
 */
export const LONG_DESCRIPTION_LENGTH = 500;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The new skill as it is kept: without the spaces around what the user typed. */
export function trimmedNewSkill(skill: NewSkill): NewSkill {
  return { ...skill, name: skill.name.trim(), description: skill.description.trim() };
}

/** Why a skill can't be called `name`, in the UI's words; empty when it can. */
export function skillNameProblems(name: string): string[] {
  if (name === "") return ["Give the skill a name."];
  const problems: string[] = [];
  if (!NAME.test(name)) {
    problems.push(
      "A skill's name is lowercase letters and digits in words joined by dashes, such as release-notes.",
    );
  }
  if (name.length > NAME_LENGTH) {
    problems.push(`A skill's name may be at most ${NAME_LENGTH} characters.`);
  }
  // The name is a folder in the library and in each session's plugin.
  if (isWindowsDeviceName(name)) {
    problems.push(`"${name}" is a name Windows keeps for a device; choose another.`);
  }
  return problems;
}

/** Why a skill can't have `description`, in the UI's words; empty when it can. */
export function skillDescriptionProblems(description: string): string[] {
  if (description === "") return ["Give the skill a description: when to use it, in one sentence."];
  if (description.length > DESCRIPTION_LENGTH) {
    return [
      `A skill's description may be at most ${DESCRIPTION_LENGTH.toLocaleString("en")} characters, as the engine lists no more of it.`,
    ];
  }
  return [];
}

/** Review's flag on a description that takes much of each session's skill listing; undefined when short. */
export function longDescriptionWarning(description: string): string | undefined {
  if (description.length <= LONG_DESCRIPTION_LENGTH) return undefined;
  return `Its description is ${description.length.toLocaleString("en")} characters: every session that has it lists all of it, which leaves less of the listing's room for other skills.`;
}

/** Why a new skill can't be saved, with every reason. */
export function newSkillProblems(skill: NewSkill): string[] {
  return [...skillNameProblems(skill.name), ...skillDescriptionProblems(skill.description)];
}

/** Why a skill can't be added under a name the library already has. */
export function skillNameTaken(name: string): string {
  return `The library already has ${name}.`;
}
