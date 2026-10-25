import type { Skill } from "./skill.js";
import { frontmatterText, readSkillMd } from "./skill-md.js";

/** The plugin a session's library skills are in, so the engine lists each as `office:<name>`. */
export const SESSION_PLUGIN = "office";

/** A library skill at the version a session got. */
export interface SessionSkill {
  readonly name: string;
  readonly version: number;
  /** What identifies the version's files: numbers start again for a name added anew. */
  readonly filesHash: string;
}

/**
 * A skill or command of the repository's own (spec §2.6), named as Claude Code 2.1.310 names
 * it (docs/engine-check.md, `skills.project-names` and `skills.overrides-off`).
 */
export interface ProjectSkill {
  /**
   * What the allowlist and `skillOverrides` match it by: a skill's folder name, whatever its
   * frontmatter says; a command's path under `commands/`, with `:` between folders.
   */
  readonly key: string;
  /**
   * What the listing names it by at a session's start: a skill's frontmatter name, or else its
   * folder's; a command's key. Undefined below the repository's top, where the engine lists it
   * only once a file below it is read.
   */
  readonly listedAs: string | undefined;
}

/** A file of the checkout that may be a Project skill or command. */
export interface ProjectSkillFile {
  /** Inside the checkout, with `/` between folders. */
  readonly path: string;
  readonly text: string;
}

const SKILL_MD_PATH = /^(?:(.+)\/)?\.claude\/skills\/([^/]+)\/SKILL\.md$/;
const COMMAND_PATH = /^(?:(.+)\/)?\.claude\/commands\/(.+)\.md$/;

/** The Project's skills and commands, each once by its key, in key order. */
export function projectSkillsFrom(files: readonly ProjectSkillFile[]): ProjectSkill[] {
  const found = new Map<string, ProjectSkill>();
  for (const file of files) {
    const skill = projectSkillOf(file);
    const earlier = found.get(skill?.key ?? "");
    // One listed at the top wins over a nested one of the same key, which lists only later.
    if (skill && (!earlier || earlier.listedAs === undefined)) found.set(skill.key, skill);
  }
  return [...found.values()].toSorted((first, second) => (first.key < second.key ? -1 : 1));
}

function projectSkillOf({ path, text }: ProjectSkillFile): ProjectSkill | undefined {
  const skill = SKILL_MD_PATH.exec(path);
  if (skill?.[2]) {
    const folder = skill[2];
    if (skill[1] !== undefined) return { key: folder, listedAs: undefined };
    const skillMd = readSkillMd(text);
    const named = typeof skillMd === "string" ? undefined : frontmatterText(skillMd, "name");
    return { key: folder, listedAs: named?.trim() || folder };
  }
  const command = COMMAND_PATH.exec(path);
  if (command?.[2]) {
    const key = command[2].split("/").join(":");
    return { key, listedAs: command[1] === undefined ? key : undefined };
  }
  return undefined;
}

/**
 * What a session got, kept until it can't be resumed, so its folder is rebuilt with the same set
 * (spec §5.6): the engine announces only added skills on resume.
 */
export interface SessionSkillRecord {
  readonly sessionId: string;
  readonly skills: readonly SessionSkill[];
  /** The Project's skills and commands it may use, when the Project allows them. */
  readonly projectSkills: readonly ProjectSkill[];
  /** The keys of the Project's skills and commands, when the Project doesn't allow them. */
  readonly projectSkillsOff: readonly string[];
  readonly preparedAt: Date;
}

/**
 * The library skills a session gets: its Role's skills and the skills for everyone, each only
 * while it is on, in name order.
 */
export function librarySkillsFor(
  library: readonly Skill[],
  roleSkills: readonly string[],
): SessionSkill[] {
  const named = new Set(roleSkills);
  return library
    .filter((skill) => skill.state === "on" && (skill.everyone || named.has(skill.name)))
    .map(({ name, version, filesHash }) => ({ name, version, filesHash }))
    .toSorted((first, second) => (first.name < second.name ? -1 : 1));
}

/** What a session records, given whether its Project allows its own skills. */
export function sessionSkillRecord(
  sessionId: string,
  skills: readonly SessionSkill[],
  projectSkills: readonly ProjectSkill[],
  useProjectSkills: boolean,
  preparedAt: Date,
): SessionSkillRecord {
  return {
    sessionId,
    skills,
    projectSkills: useProjectSkills ? projectSkills : [],
    projectSkillsOff: useProjectSkills ? [] : projectSkills.map((skill) => skill.key),
    preparedAt,
  };
}

function libraryNames(record: SessionSkillRecord): string[] {
  return record.skills.map((skill) => `${SESSION_PLUGIN}:${skill.name}`);
}

/** The engine's allowlist: the library's skills by full name, the Project's by their keys. */
export function allowedSkillNames(record: SessionSkillRecord): string[] {
  return [...libraryNames(record), ...record.projectSkills.map((skill) => skill.key)];
}

/**
 * What the session must list at its start, no more and no less: the library's skills and the
 * Project's at the repository's top, by the names the listing gives them.
 */
export function expectedSkillNames(record: SessionSkillRecord): string[] {
  return [
    ...libraryNames(record),
    ...record.projectSkills.flatMap((skill) => skill.listedAs ?? []),
  ].toSorted();
}

/**
 * Where an allowed Project skill would also allow another skill: the allowlist matches a name
 * or its `:<name>` suffix, so the Project's `review` also allows `office:review`.
 */
export function suffixMatches(record: SessionSkillRecord): string[] {
  const library = new Set(record.skills.map((skill) => skill.name));
  return record.projectSkills
    .filter((skill) => library.has(skill.key))
    .map(
      ({ key }) =>
        `The Project's skill ${key} also allows the library's ${SESSION_PLUGIN}:${key}, which this session has too.`,
    );
}

/** The engine's `skillOverrides` setting for the session: each Project skill off, by its key. */
export function skillOverridesOf(record: SessionSkillRecord): Record<string, "off"> {
  return Object.fromEntries(record.projectSkillsOff.map((key) => [key, "off"]));
}
