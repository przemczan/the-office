/**
 * Which commands an Agent may run. Read-only git is allowed under each, and none allows a git command
 * that changes anything (spec §6). The Project's own commands are its command lines, read from the
 * Project when a session starts.
 */
export const RUN_PERMISSIONS = ["read-only-git", "project-commands", "anything"] as const;
export type RunPermission = (typeof RUN_PERMISSIONS)[number];

/**
 * What a Role's Agents may do, as data on its Role card; a Stage may narrow it, never widen it. Every
 * Agent reads its worktree and its skills folder, and a chat only reads, whatever the profile says
 * (spec §6). Shown read-only until tier 2.
 */
export interface PermissionProfile {
  /** Whether it edits files in its worktree. */
  readonly edit: boolean;
  readonly run: RunPermission;
  /** Whether it searches and fetches the web. */
  readonly web: boolean;
}
