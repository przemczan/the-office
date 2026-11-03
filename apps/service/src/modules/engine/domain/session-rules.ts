import type { PermissionProfile } from "./permission-profile.js";

/** How the system The Office runs on reads paths, which the rules compare. */
export interface PathSemantics {
  /** `path` made absolute, read relative to `base` when it is relative, and normalized. */
  resolve(base: string, path: string): string;
  /** Whether the absolute `path` is `folder` or inside it. */
  isWithin(path: string, folder: string): boolean;
  /** The names a path is made of, in the form the system compares them. */
  names(path: string): string[];
}

/** What the Office rules judge one session's tool calls by (spec §6). */
export interface SessionRules {
  /** The folder the session works in, a Task's worktree: the only one it edits. */
  readonly workingFolder: string;
  /** The folders it reads besides, such as its skills folder. */
  readonly readableFolders: readonly string[];
  readonly profile: PermissionProfile;
  /**
   * Whether the session reaches the whole workstation: a Caretaker Thread with changes allowed
   * (spec §6). It then reads and edits anywhere and runs any git command; only the secrets hold.
   */
  readonly workstation: boolean;
  /**
   * The user's secrets and The Office's (SSH keys, credentials, browser profiles, the engines'
   * accounts, the Office identity, the database credentials), absolute, files or folders: refused
   * to every session.
   */
  readonly secrets: readonly string[];
  /**
   * The Office's own files and folders, such as its data directory, outside the session's folders:
   * refused to every session but one that reaches the workstation.
   */
  readonly officeFiles: readonly string[];
  /**
   * The folders inside The Office's files that hold Projects' clones (spec §5.5 Defaults): not The
   * Office's own, so a session reads them as it reads a path-added Project's folder.
   */
  readonly cloneFolders: readonly string[];
  readonly homeFolder: string;
  /** The variables the session's commands run with, which a command line may name. */
  readonly environment: Readonly<Record<string, string>>;
  readonly paths: PathSemantics;
  /**
   * What the Agent can do about a call its folders or its profile refuse, added to the refusal,
   * such as asking the user to Allow changes; undefined when there is nothing to add.
   */
  readonly refusalAdvice?: string;
}
