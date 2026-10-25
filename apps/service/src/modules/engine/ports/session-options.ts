import type { PermissionProfile } from "../domain/permission-profile.js";
import type { OfficeTool } from "./office-tool.js";

/** How hard the model thinks, as a Role card names it. */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** A session's skills, as the Skills module prepared them (spec §5.6). */
export interface SessionSkills {
  /** The session's own plugin folder outside the worktree, which the file tools may read. */
  readonly folder: string;
  /** The skills the session may list, and must list at its start, by the names it lists them by. */
  readonly names: readonly string[];
  /** The engine's per-skill listing overrides: each Project skill turned off, by bare name. */
  readonly overrides: Readonly<Record<string, "off">>;
}

/** A JSON Schema document, as an engine takes it for a turn's output. */
export type JsonSchema = Readonly<Record<string, unknown>>;

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
  /** Undefined for a session with no skill at all, not even the Project's. */
  readonly skills: SessionSkills | undefined;
  readonly profile: PermissionProfile;
  readonly officeTools: readonly OfficeTool[];
  /** What each turn's output must match, or undefined for a reply in plain words. */
  readonly outputSchema: JsonSchema | undefined;
}
