import type { Skill } from "./skill.js";
import { frontmatterText, isUserOnly, readSkillMd } from "./skill-md.js";

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
export interface ProjectSkillName {
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
  /**
   * Set at the repository's top when only the user runs it, as a skill command
   * (`disable-model-invocation: true`): the listing the model sees leaves it out.
   */
  readonly userOnly?: true;
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
export function projectSkillNamesFrom(files: readonly ProjectSkillFile[]): ProjectSkillName[] {
  const found = new Map<string, ProjectSkillName>();
  for (const file of files) {
    const skill = projectSkillNameOf(file);
    const earlier = found.get(skill?.key ?? "");
    // One listed at the top wins over a nested one of the same key, which lists only later.
    if (skill && (!earlier || earlier.listedAs === undefined)) found.set(skill.key, skill);
  }
  return [...found.values()].toSorted((first, second) => (first.key < second.key ? -1 : 1));
}

/** The Project skill or command a file is, or undefined for one that is neither. */
export function projectSkillNameOf({ path, text }: ProjectSkillFile): ProjectSkillName | undefined {
  const skill = SKILL_MD_PATH.exec(path);
  if (skill?.[2]) {
    const folder = skill[2];
    if (skill[1] !== undefined) return { key: folder, listedAs: undefined };
    const skillMd = readSkillMd(text);
    const named = typeof skillMd === "string" ? undefined : frontmatterText(skillMd, "name");
    return withUserOnly({ key: folder, listedAs: named?.trim() || folder }, text);
  }
  const command = COMMAND_PATH.exec(path);
  if (command?.[2]) {
    const key = command[2].split("/").join(":");
    if (command[1] !== undefined) return { key, listedAs: undefined };
    return withUserOnly({ key, listedAs: key }, text);
  }
  return undefined;
}

function withUserOnly(skill: ProjectSkillName, text: string): ProjectSkillName {
  return isUserOnly(readSkillMd(text)) ? { ...skill, userOnly: true } : skill;
}

/**
 * What a session got, kept until it can't be resumed, so its folder is rebuilt with the same set
 * (spec §5.6): the engine announces only added skills on resume.
 */
export interface SessionSkillRecord {
  readonly sessionId: string;
  readonly skills: readonly SessionSkill[];
  /** The Project the session works in, or undefined for one outside any Project. */
  readonly projectId: string | undefined;
  /** The Project's skills and commands it may use: those the Project has on. */
  readonly projectSkills: readonly ProjectSkillName[];
  /** The keys of the Project's skills and commands it found that the Project has off. */
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

/** Which of the repository's skills a Project gives its sessions (spec §2.6). */
export interface ProjectSkillUse {
  /** Off, sessions get none of them. */
  readonly useProjectSkills: boolean;
  /** The keys turned off one by one. A skill found under any other key is on. */
  readonly projectSkillsOff: readonly string[];
}

/**
 * What a session records: the skills it found, split by what its Project has on. An off key the
 * repository no longer holds is left out, since the engine has nothing to turn off.
 */
export function sessionSkillRecord(
  sessionId: string,
  skills: readonly SessionSkill[],
  projectId: string | undefined,
  projectSkills: readonly ProjectSkillName[],
  { useProjectSkills, projectSkillsOff }: ProjectSkillUse,
  preparedAt: Date,
): SessionSkillRecord {
  const isOff = (skill: ProjectSkillName): boolean =>
    !useProjectSkills || projectSkillsOff.includes(skill.key);
  return {
    sessionId,
    skills,
    projectId,
    projectSkills: projectSkills.filter((skill) => !isOff(skill)),
    projectSkillsOff: projectSkills.filter(isOff).map((skill) => skill.key),
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
 * Project's at the repository's top, by the names the listing gives them, but for those only the
 * user runs, which the model's listing leaves out. `userOnlyLibrary` names the library's by name.
 */
export function expectedSkillNames(
  record: SessionSkillRecord,
  userOnlyLibrary: ReadonlySet<string> = new Set(),
): string[] {
  const userOnly = new Set(userOnlySkillNames(record, userOnlyLibrary));
  return [...libraryNames(record), ...record.projectSkills.flatMap((skill) => skill.listedAs ?? [])]
    .filter((name) => !userOnly.has(name))
    .toSorted();
}

/**
 * The skills only the user runs, as skill commands, by the names the session lists them by: the
 * library's named in `userOnlyLibrary` and the Project's at the repository's top flagged so.
 */
export function userOnlySkillNames(
  record: SessionSkillRecord,
  userOnlyLibrary: ReadonlySet<string>,
): string[] {
  return [
    ...record.skills
      .filter((skill) => userOnlyLibrary.has(skill.name))
      .map((skill) => `${SESSION_PLUGIN}:${skill.name}`),
    ...record.projectSkills.flatMap((skill) =>
      skill.userOnly && skill.listedAs !== undefined ? [skill.listedAs] : [],
    ),
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
