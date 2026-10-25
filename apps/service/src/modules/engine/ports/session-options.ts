import type { PermissionProfile } from "../domain/permission-profile.js";
import type { OfficeTool } from "./office-tool.js";

/** How hard the model thinks, as a Role card names it. */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

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
  /** The session's own skills folder outside the worktree (spec §5.6), or undefined without skills. */
  readonly skillsFolder: string | undefined;
  readonly profile: PermissionProfile;
  readonly officeTools: readonly OfficeTool[];
  /** What each turn's output must match, or undefined for a reply in plain words. */
  readonly outputSchema: JsonSchema | undefined;
}
