import type { ProjectSkillFile } from "../domain/session-skills.js";

/** Finds a repository's own skills in a checkout of it, such as a Task's worktree. */
export abstract class ProjectSkillFiles {
  /**
   * Each file that may be a Project skill or command, with its text: every
   * `.claude/skills/*\/SKILL.md` and `.claude/commands/**\/*.md`, at any depth, that git tracks
   * or would track.
   */
  abstract files(folder: string): Promise<readonly ProjectSkillFile[]>;
}
