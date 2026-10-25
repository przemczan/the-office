import type { OfficeTool } from "./office-tool.js";

/** How hard the model thinks, as a Role card names it. */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** A JSON Schema document, as an engine takes it for a turn's output. */
export type JsonSchema = Readonly<Record<string, unknown>>;

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

/**
 * What a session runs with. A resumed session is given the same options as when it started:
 * a changed model, effort or set of Office tools breaks its cached prefix (spec §5.4).
 */
export interface SessionOptions {
  /** The folder the session works in, such as a Task's worktree. */
  readonly folder: string;
  /**
   * The variables the session and its commands run with, such as a Project's command environment
   * (spec §5.5). The engine may drop those that would change how it runs itself.
   */
  readonly environment: Readonly<Record<string, string>>;
  readonly model: string;
  readonly effort: Effort;
  /** The session's own skills folder outside the worktree (spec §5.6), or undefined without skills. */
  readonly skillsFolder: string | undefined;
  readonly profile: PermissionProfile;
  readonly officeTools: readonly OfficeTool[];
  /** What each turn's output must match, or undefined for a reply in plain words. */
  readonly outputSchema: JsonSchema | undefined;
}
