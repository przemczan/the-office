/** Finds a repository's own skills in a checkout of it, such as a Task's worktree. */
export abstract class ProjectSkillFiles {
  /**
   * The path, inside the checkout and with `/` between folders, of each file that may be a
   * Project skill or command: every `.claude/skills/*\/SKILL.md` and `.claude/commands/**\/*.md`,
   * at any depth, that git tracks or would track.
   */
  abstract paths(folder: string): Promise<readonly string[]>;
}
