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
  /** Where the user's secrets are, absolute, files or folders. */
  readonly userSecrets: readonly string[];
  /** The Office's own files and folders, such as its data directory, outside the session's folders. */
  readonly officeFiles: readonly string[];
  readonly homeFolder: string;
  /** The variables the session's commands run with, which a command line may name. */
  readonly environment: Readonly<Record<string, string>>;
  readonly paths: PathSemantics;
}
