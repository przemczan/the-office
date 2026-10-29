import type { PermissionProfile } from "../domain/permission-profile.js";
import type { OfficeTool } from "./office-tool.js";

/** How hard the model thinks, as a Role card names it. */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** A session's skills, as the Skills module prepared them (spec §5.6). */
export interface SessionSkills {
  /** The session's own plugin folder outside the worktree, which the file tools may read. */
  readonly folder: string;
  /** The engine's allowlist: the names the engine matches skills by. */
  readonly names: readonly string[];
  /** What the session must list at its start, no more and no less, by the names it lists them by. */
  readonly expected: readonly string[];
  /** The engine's per-skill listing overrides: each Project skill turned off. */
  readonly overrides: Readonly<Record<string, "off">>;
}

/**
 * Asked before each tool call of a session, after the engine's input validation: the words that
 * refuse it while The Office holds every tool call, such as while the fire alarm is on (spec
 * §2.8), or undefined to judge the call by the Office rules.
 */
export type ToolHold = () => Promise<string | undefined>;

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
  /**
   * The Agent's standing instructions, such as its Role card's, added to the engine's system
   * prompt. The same for every session of a card version, so they stay in the cached prefix.
   */
  readonly instructions: string;
  /** Undefined for a session with no skill at all, not even the Project's. */
  readonly skills: SessionSkills | undefined;
  readonly profile: PermissionProfile;
  readonly officeTools: readonly OfficeTool[];
  /** What each turn's output must match, or undefined for a reply in plain words. */
  readonly outputSchema: JsonSchema | undefined;
  /** Undefined for a session whose tool calls The Office never holds as a whole. */
  readonly toolHold?: ToolHold;
}
