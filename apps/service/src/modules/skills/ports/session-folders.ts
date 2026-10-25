import type { SkillFile } from "../domain/skill-files.js";

/** A library skill as a session's folder holds it. */
export interface SessionFolderSkill {
  readonly name: string;
  readonly files: readonly SkillFile[];
}

/**
 * Each session's own plugin folder, `<office-data>/sessions/<session id>/skills/`, outside the
 * worktree and the library (spec §5.6).
 */
export abstract class SessionFolders {
  /**
   * Writes the session's folder afresh, as regular files only, and returns its path: the plugin's
   * manifest and a copy of each skill.
   */
  abstract write(sessionId: string, skills: readonly SessionFolderSkill[]): Promise<string>;

  /** Does nothing when the session has no folder. */
  abstract remove(sessionId: string): Promise<void>;

  /** Removes the folder of every session `keep` refuses. */
  abstract prune(keep: (sessionId: string) => boolean): Promise<void>;
}
