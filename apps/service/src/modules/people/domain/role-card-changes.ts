import type { EngineModel } from "../../engine/index.js";
import {
  HARD_SWITCH_KEYS,
  sameHardSwitchValue,
  type HardSwitchKey,
  type HardSwitchValue,
} from "./hard-switches.js";
import { MCP_TOOL_DEFAULT, type McpToolSettings } from "./mcp-tool-settings.js";
import type { PermissionProfile } from "./permission-profile.js";
import type { Capabilities, RoleCard } from "./role-card.js";
import type { TaskLimit } from "./task-limit.js";

const PLAIN_FIELDS = [
  "name",
  "title",
  "responsibilities",
  "instructions",
  "effort",
  "taskLimit",
  "sessionDefault",
] as const;
const CAPABILITY_KEYS = [
  "sharedMemory",
  "chat",
  "consultant",
] as const satisfies readonly (keyof Capabilities)[];

/**
 * A part of a Role card as its change history names it, down to each capability and switch.
 * `engine` and `model` are named only by entries saved before the card had a Role override.
 */
export type RoleCardField =
  | (typeof PLAIN_FIELDS)[number]
  | "engine"
  | "model"
  | "roleOverride"
  | `capabilities.${keyof Capabilities}`
  | "permissionProfile"
  | `hardSwitches.${HardSwitchKey}`;

/** A Role override of none reads as the Office default. */
export type RoleCardValue =
  string | TaskLimit | boolean | PermissionProfile | HardSwitchValue | EngineModel | null;

/** One part of the card, from what it was to what it became. */
export interface RoleCardFieldChange {
  readonly field: RoleCardField;
  readonly from: RoleCardValue;
  readonly to: RoleCardValue;
}

/** What differs from `before` to `after`, in the card's order. */
export function roleCardChanges(before: RoleCard, after: RoleCard): RoleCardFieldChange[] {
  const changes: RoleCardFieldChange[] = [];
  for (const field of PLAIN_FIELDS) {
    if (before[field] !== after[field]) {
      changes.push({ field, from: before[field], to: after[field] });
    }
  }
  if (!sameRoleOverride(before.roleOverride, after.roleOverride)) {
    changes.push({ field: "roleOverride", from: before.roleOverride, to: after.roleOverride });
  }
  for (const key of CAPABILITY_KEYS) {
    const from = before.capabilities[key];
    const to = after.capabilities[key];
    if (from !== to) changes.push({ field: `capabilities.${key}`, from, to });
  }
  if (!samePermissionProfile(before.permissionProfile, after.permissionProfile)) {
    changes.push({
      field: "permissionProfile",
      from: before.permissionProfile,
      to: after.permissionProfile,
    });
  }
  for (const key of HARD_SWITCH_KEYS) {
    const from = before.hardSwitches[key];
    const to = after.hardSwitches[key];
    if (!sameHardSwitchValue(from, to)) changes.push({ field: `hardSwitches.${key}`, from, to });
  }
  return changes;
}

function sameRoleOverride(first: EngineModel | null, second: EngineModel | null): boolean {
  return first?.engineId === second?.engineId && first?.model === second?.model;
}

function samePermissionProfile(first: PermissionProfile, second: PermissionProfile): boolean {
  return (
    first.edit === second.edit &&
    first.run === second.run &&
    first.web === second.web &&
    sameMcpToolSettings(first.mcpTools, second.mcpTools)
  );
}

/** A tool left unset and one set at the default are the same setting. */
function sameMcpToolSettings(first: McpToolSettings, second: McpToolSettings): boolean {
  const keys = new Set([...Object.keys(first), ...Object.keys(second)]);
  return [...keys].every((key) =>
    sameHardSwitchValue(first[key] ?? MCP_TOOL_DEFAULT, second[key] ?? MCP_TOOL_DEFAULT),
  );
}
