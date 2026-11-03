import { isDeepStrictEqual } from "node:util";
import { ALLOWED, NEVER } from "./hard-switches.js";
import { CARETAKER } from "./known-roles.js";
import type { RoleCard } from "./role-card.js";

/**
 * The parts of the Caretaker's card that are fixed (spec §2.2): a chat only, with Memory, no
 * Consultant, no Task limit, so no Pipeline names them, and the profile and Hard switches Allow
 * changes grants. The rest of the card is the user's to change.
 */
export const CARETAKER_FIXED_PARTS = {
  capabilities: { sharedMemory: true, chat: true, consultant: false },
  permissionProfile: { edit: true, run: "anything", web: true },
  hardSwitches: { runInstalls: ALLOWED, publishOutsideThePipeline: ALLOWED, changeRoles: NEVER },
  taskLimit: "none",
} as const satisfies Pick<RoleCard, "capabilities" | "hardSwitches" | "taskLimit"> & {
  readonly permissionProfile: Omit<RoleCard["permissionProfile"], "mcpTools">;
};

/** Whether the Role is the built-in Caretaker's. */
export function isBuiltIn(roleKey: string): boolean {
  return roleKey === CARETAKER;
}

/** Why the card can't be the Caretaker's: each fixed part it changes. Empty for any other Role. */
export function builtInCardProblems(roleKey: string, card: RoleCard): string[] {
  if (!isBuiltIn(roleKey)) return [];
  const fixed = CARETAKER_FIXED_PARTS;
  const { edit, run, web } = card.permissionProfile;
  return [
    ...(isDeepStrictEqual(card.capabilities, fixed.capabilities)
      ? []
      : ["The Caretaker's capabilities are fixed: Chat and Memory on, not a Consultant."]),
    ...(isDeepStrictEqual({ edit, run, web }, fixed.permissionProfile)
      ? []
      : [
          "The Caretaker's permission profile is fixed: Allow changes in a Thread gives everything but secrets.",
        ]),
    ...(isDeepStrictEqual(card.hardSwitches, fixed.hardSwitches)
      ? []
      : ["The Caretaker's Hard switches are fixed."]),
    ...(card.taskLimit === fixed.taskLimit
      ? []
      : ["The Caretaker's Task limit is fixed at none: they only chat."]),
  ];
}
