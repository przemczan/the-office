import { projectSkillOf, type ProjectSkillFile } from "./session-skills.js";
import { frontmatterText, readSkillMd } from "./skill-md.js";

/** A skill or command of the repository's own, as the Project page lists it, read-only. */
export interface RepositorySkill {
  /** As a session lists it. */
  readonly name: string;
  readonly description: string;
  /** The skill's folder, or the command's file, inside the repository. */
  readonly path: string;
  /** False below the repository's top, where a session lists it only once a file below it is read. */
  readonly listedAtStart: boolean;
  /**
   * The library has a skill of the same name, which a session that has both would also allow
   * and list (spec §5.6: the allowlist matches by suffix).
   */
  readonly alsoInLibrary: boolean;
}

/** The repository's skills and commands, by path, with what the library also has. */
export function repositorySkillsFrom(
  files: readonly ProjectSkillFile[],
  libraryNames: ReadonlySet<string>,
): RepositorySkill[] {
  return files
    .flatMap((file) => {
      const skill = projectSkillOf(file);
      if (!skill) return [];
      return [
        {
          name: skill.listedAs ?? skill.key,
          description: descriptionOf(file.text),
          path: file.path.replace(/\/SKILL\.md$/, ""),
          listedAtStart: skill.listedAs !== undefined,
          alsoInLibrary: libraryNames.has(skill.key),
        },
      ];
    })
    .toSorted((first, second) => (first.path < second.path ? -1 : 1));
}

function descriptionOf(text: string): string {
  const skillMd = readSkillMd(text);
  return typeof skillMd === "string" ? "" : (frontmatterText(skillMd, "description")?.trim() ?? "");
}
