/**
 * Which commands an Agent may run. Read-only git is allowed under each, and no profile allows a git
 * command that changes anything (spec §6).
 */
export type CommandPermission =
  | { readonly kind: "read-only-git" }
  /** The Project's own commands, as their command lines. */
  | { readonly kind: "project-commands"; readonly commandLines: readonly string[] }
  | { readonly kind: "anything" };

/**
 * What an Agent may do, as data from its Role card, narrowed by a Stage (spec §6). An Agent reads
 * its working folder and its skills folder under every profile.
 */
export interface PermissionProfile {
  /** Whether it edits files in its working folder. */
  readonly edit: boolean;
  readonly run: CommandPermission;
  /** Whether it searches and fetches the web. */
  readonly web: boolean;
}
