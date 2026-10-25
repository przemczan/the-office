import type { Skill } from "./skill.js";

/** The plugin a session's library skills are in, so the engine lists each as `office:<name>`. */
export const SESSION_PLUGIN = "office";

/** A library skill at the version a session got. */
export interface SessionSkill {
  readonly name: string;
  readonly version: number;
  /** What identifies the version's files: numbers start again for a name added anew. */
  readonly filesHash: string;
}

/** The repository's own skills, as found in a Task's worktree (spec §2.6). */
export interface ProjectSkills {
  /** The bare name of each skill under a `.claude/skills` folder anywhere in the repository. */
  readonly skills: readonly string[];
  /** The bare name of each `.claude/commands` file, which the engine lists among skills too. */
  readonly commands: readonly string[];
}

/**
 * The Project's skills, from the paths of the repository's files with `/` between folders:
 * `<any folder>/.claude/skills/<name>/SKILL.md` and `<any folder>/.claude/commands/**\/<name>.md`.
 * The engine lists nested ones by their bare name too (docs/engine-check.md, `skills.overrides-off`).
 */
export function projectSkillsFrom(paths: readonly string[]): ProjectSkills {
  const skills: string[] = [];
  const commands: string[] = [];
  for (const path of paths) {
    const skill = /(?:^|\/)\.claude\/skills\/([^/]+)\/SKILL\.md$/.exec(path);
    if (skill?.[1]) skills.push(skill[1]);
    const command = /(?:^|\/)\.claude\/commands\/(?:[^/]+\/)*([^/]+)\.md$/.exec(path);
    if (command?.[1]) commands.push(command[1]);
  }
  return { skills: sortedUnique(skills), commands: sortedUnique(commands) };
}

/**
 * What a session got, kept until it can't be resumed, so its folder is rebuilt with the same set
 * (spec §5.6): the engine announces only added skills on resume.
 */
export interface SessionSkillRecord {
  readonly sessionId: string;
  readonly skills: readonly SessionSkill[];
  /** The Project's skills it may use, when the Project allows them. */
  readonly projectSkills: readonly string[];
  /** The Project's skills and commands turned off, when the Project doesn't allow them. */
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
  projectSkills: ProjectSkills | undefined,
  useProjectSkills: boolean,
  preparedAt: Date,
): SessionSkillRecord {
  const found = projectSkills ?? { skills: [], commands: [] };
  return {
    sessionId,
    skills,
    projectSkills: useProjectSkills ? sortedUnique(found.skills) : [],
    projectSkillsOff: useProjectSkills ? [] : sortedUnique([...found.skills, ...found.commands]),
    preparedAt,
  };
}

/**
 * The names the engine's allowlist gets, which are also what the session must list at its start:
 * the library's by full name, the Project's by the bare name the engine lists them by.
 */
export function allowedSkillNames(record: SessionSkillRecord): string[] {
  return [
    ...record.skills.map((skill) => `${SESSION_PLUGIN}:${skill.name}`),
    ...record.projectSkills,
  ];
}

/**
 * Where an allowed Project skill would also allow another skill: the allowlist matches a name
 * or its `:<name>` suffix, so the Project's `review` also allows `office:review`.
 */
export function suffixMatches(record: SessionSkillRecord): string[] {
  const library = new Set(record.skills.map((skill) => skill.name));
  return record.projectSkills
    .filter((name) => library.has(name))
    .map(
      (name) =>
        `The Project's skill ${name} also allows the library's ${SESSION_PLUGIN}:${name}, which this session has too.`,
    );
}

/** The engine's `skillOverrides` setting for the session: each Project skill off, by bare name. */
export function skillOverridesOf(record: SessionSkillRecord): Record<string, "off"> {
  return Object.fromEntries(record.projectSkillsOff.map((name) => [name, "off"]));
}

function sortedUnique(names: readonly string[]): string[] {
  return [...new Set(names)].toSorted();
}
