import {
  HARD_SWITCH_KEYS,
  sameHardSwitchValue,
  type HardSwitchKey,
  type HardSwitchValue,
} from "./hard-switches.js";
import type { PermissionProfile } from "./permission-profile.js";
import type { Capabilities, RoleCard } from "./role-card.js";
import type { TaskLimit } from "./task-limit.js";

const PLAIN_FIELDS = [
  "name",
  "title",
  "responsibilities",
  "instructions",
  "engine",
  "model",
  "effort",
  "taskLimit",
  "sessionDefault",
] as const;
const CAPABILITY_KEYS = [
  "sharedMemory",
  "chat",
  "consultant",
] as const satisfies readonly (keyof Capabilities)[];

/** A part of a Role card as its change history names it, down to each capability and switch. */
export type RoleCardField =
  | (typeof PLAIN_FIELDS)[number]
  | `capabilities.${keyof Capabilities}`
  | "permissionProfile"
  | `hardSwitches.${HardSwitchKey}`;

export type RoleCardValue = string | TaskLimit | boolean | PermissionProfile | HardSwitchValue;

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

function samePermissionProfile(first: PermissionProfile, second: PermissionProfile): boolean {
  return first.edit === second.edit && first.run === second.run && first.web === second.web;
}
