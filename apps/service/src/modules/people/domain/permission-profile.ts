import { mcpToolDefault } from "./duties.js";
import type { HardSwitchValue } from "./hard-switches.js";
import {
  mcpToolSettingsProblems,
  narrowedMcpToolSetting,
  noWiderThan,
  type McpToolSettings,
} from "./mcp-tool-settings.js";
import type { RoleCardContext } from "./role-card.js";

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
 * (spec §6). Sessions started after an edit get it.
 */
export interface PermissionProfile {
  /** Whether it edits files in its worktree. */
  readonly edit: boolean;
  readonly run: RunPermission;
  /** Whether it searches and fetches the web. */
  readonly web: boolean;
  /** Each tool of the Role's MCP servers, as the user set it. */
  readonly mcpTools: McpToolSettings;
}

/**
 * What a Stage states of its Role's profile (spec §6), each absent where the card's stands. Editing
 * and the web can only be taken away; a run permission or an MCP tool's setting wider than the
 * card's leaves the card's.
 */
export interface PermissionNarrowing {
  readonly edit?: false;
  readonly run?: RunPermission;
  readonly web?: false;
  /** Keyed `server/tool`, as the card's; a tool the Role's servers don't have is ignored. */
  readonly mcpTools?: McpToolSettings;
}

/**
 * The card's profile under a Stage's narrowing: each part the narrower of the two, an MCP tool the
 * card leaves unset standing at `toolDefault`.
 */
export function narrowedPermissionProfile(
  profile: PermissionProfile,
  narrowing: PermissionNarrowing | undefined,
  toolDefault: HardSwitchValue,
): PermissionProfile {
  if (!narrowing) return profile;
  return {
    edit: profile.edit && narrowing.edit === undefined,
    run: narrowing.run && runNoWiderThan(narrowing.run, profile.run) ? narrowing.run : profile.run,
    web: profile.web && narrowing.web === undefined,
    mcpTools: narrowedMcpTools(profile.mcpTools, narrowing.mcpTools ?? {}, toolDefault),
  };
}

/** What a Stage's narrowing is checked against, as a card is. */
export type PermissionNarrowingContext = Pick<RoleCardContext, "consultable" | "mcpConsultant">;

/**
 * Why a Stage's narrowing of `roleKey`'s profile can't stand, in the UI's words; empty when it can.
 * A setting wider than the card's is named, since the card's would apply instead.
 */
export function permissionNarrowingProblems(
  roleKey: string,
  profile: PermissionProfile,
  narrowing: PermissionNarrowing,
  { consultable, mcpConsultant }: PermissionNarrowingContext,
): string[] {
  const problems: string[] = [];
  if (narrowing.run && !runNoWiderThan(narrowing.run, profile.run)) {
    problems.push("the run permission can only be narrowed from the Role card's.");
  }
  const mcpTools = narrowing.mcpTools ?? {};
  problems.push(...mcpToolSettingsProblems(roleKey, mcpTools, consultable, mcpConsultant));
  for (const [key, setting] of Object.entries(mcpTools)) {
    if (!noWiderThan(setting, profile.mcpTools[key] ?? mcpToolDefault(mcpConsultant))) {
      problems.push(`the MCP tool ${key} can only be narrowed from the Role card's setting.`);
    }
  }
  return problems;
}

function runNoWiderThan(run: RunPermission, than: RunPermission): boolean {
  return RUN_PERMISSIONS.indexOf(run) <= RUN_PERMISSIONS.indexOf(than);
}

/** The card's settings with the Stage's applied: the tools either sets, each the narrower one. */
function narrowedMcpTools(
  card: McpToolSettings,
  stage: McpToolSettings,
  toolDefault: HardSwitchValue,
): McpToolSettings {
  const keys = new Set([...Object.keys(card), ...Object.keys(stage)]);
  return Object.fromEntries(
    [...keys].map((key) => [key, narrowedMcpToolSetting(card[key] ?? toolDefault, stage[key])]),
  );
}
