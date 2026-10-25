import type { SkillFile } from "../domain/skill-files.js";

/**
 * The library's one folder, holding each skill once in its own folder (spec §2.6) and, inside
 * it, the files of each version, which never change once kept.
 */
export abstract class LibraryFolder {
  /**
   * Keeps `files` as a version of the skill and returns their files hash. Keeping the same files
   * again changes nothing. That they follow `skillFilesProblems` is for the caller to know.
   */
  abstract keep(skillName: string, files: readonly SkillFile[]): Promise<string>;

  /**
   * The files of the skill's version with `filesHash`, in path order. Throws SkillVersionMissing
   * when the library doesn't have them as they were kept.
   */
  abstract read(skillName: string, filesHash: string): Promise<readonly SkillFile[]>;
}
