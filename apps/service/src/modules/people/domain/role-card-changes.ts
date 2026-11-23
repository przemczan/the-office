import type { EngineModel } from "../../engine/index.js";
import {
  HARD_SWITCH_KEYS,
  sameHardSwitchValue,
  type HardSwitchKey,
  type HardSwitchValue,
} from "./hard-switches.js";
import type { McpToolSettings } from "./mcp-tool-settings.js";
import type { PermissionProfile } from "./permission-profile.js";
import type {
  Capabilities,
  EngineTypeSetting,
  PersonEngineSettings,
  RoleCard,
} from "./role-card.js";
import type { TaskLimit } from "./task-limit.js";

const PLAIN_FIELDS = [
  "name",
  "title",
  "responsibilities",
  "instructions",
  "taskLimit",
  "sessionDefault",
] as const;
const CAPABILITY_KEYS = [
  "sharedMemory",
  "chat",
  "consultant",
  "runEnvironment",
] as const satisfies readonly (keyof Capabilities)[];

/**
 * A part of a Role card as its change history names it, down to each capability and switch.
 * `engine` and `model` are named only by entries saved before the card had a Role override, and
 * `roleOverride` and `effort` only by entries saved before it had `engineSettings`.
 * `engineSettingsMovedOver` says a card moved over to `engineSettings`: from its Role override, or
 * none, to the engine type the override's model moved to, or none when it had none or it was dropped.
 */
export type RoleCardField =
  | (typeof PLAIN_FIELDS)[number]
  | "engine"
  | "model"
  | "roleOverride"
  | "effort"
  | "engineSettings"
  | "engineSettingsMovedOver"
  | `capabilities.${keyof Capabilities}`
  | "permissionProfile"
  | `hardSwitches.${HardSwitchKey}`;

/** A Role override of none read as the Office default. */
export type RoleCardValue =
  | string
  | TaskLimit
  | boolean
  | PermissionProfile
  | HardSwitchValue
  | EngineModel
  | PersonEngineSettings
  | null;

/** One part of the card, from what it was to what it became. */
export interface RoleCardFieldChange {
  readonly field: RoleCardField;
  readonly from: RoleCardValue;
  readonly to: RoleCardValue;
}

/**
 * What differs from `before` to `after`, in the card's order; an MCP tool left unset stands at
 * `mcpToolDefault`.
 */
export function roleCardChanges(
  before: RoleCard,
  after: RoleCard,
  mcpToolDefault: HardSwitchValue,
): RoleCardFieldChange[] {
  const changes: RoleCardFieldChange[] = [];
  for (const field of PLAIN_FIELDS) {
    if (before[field] !== after[field]) {
      changes.push({ field, from: before[field], to: after[field] });
    }
  }
  if (!sameEngineSettings(before.engineSettings, after.engineSettings)) {
    changes.push({
      field: "engineSettings",
      from: before.engineSettings,
      to: after.engineSettings,
    });
  }
  for (const key of CAPABILITY_KEYS) {
    const from = before.capabilities[key];
    const to = after.capabilities[key];
    if (from !== to) changes.push({ field: `capabilities.${key}`, from, to });
  }
  if (!samePermissionProfile(before.permissionProfile, after.permissionProfile, mcpToolDefault)) {
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

/** A type left out and one set to the engine's default model and effort are the same setting. */
function sameEngineSettings(first: PersonEngineSettings, second: PersonEngineSettings): boolean {
  const types = new Set([...Object.keys(first), ...Object.keys(second)]) as Set<
    keyof PersonEngineSettings
  >;
  return [...types].every((type) => sameSetting(first[type], second[type]));
}

function sameSetting(
  first: EngineTypeSetting | undefined,
  second: EngineTypeSetting | undefined,
): boolean {
  return (
    (first?.model ?? null) === (second?.model ?? null) &&
    (first?.effort ?? null) === (second?.effort ?? null)
  );
}

function samePermissionProfile(
  first: PermissionProfile,
  second: PermissionProfile,
  mcpToolDefault: HardSwitchValue,
): boolean {
  return (
    first.edit === second.edit &&
    first.run === second.run &&
    first.web === second.web &&
    sameMcpToolSettings(first.mcpTools, second.mcpTools, mcpToolDefault)
  );
}

/** A tool left unset and one set at the default are the same setting. */
function sameMcpToolSettings(
  first: McpToolSettings,
  second: McpToolSettings,
  mcpToolDefault: HardSwitchValue,
): boolean {
  const keys = new Set([...Object.keys(first), ...Object.keys(second)]);
  return [...keys].every((key) =>
    sameHardSwitchValue(first[key] ?? mcpToolDefault, second[key] ?? mcpToolDefault),
  );
}
