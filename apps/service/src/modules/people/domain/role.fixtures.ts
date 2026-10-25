import { presetFor } from "./presets.js";
import type { Role } from "./role.js";
import type { RoleCard } from "./role-card.js";

/** The Developer preset's card, named Ada. */
export function aRoleCard(fields: Partial<RoleCard> = {}): RoleCard {
  const preset = presetFor("developer");
  if (!preset) throw new Error("The Developer preset is missing.");
  return { ...preset.card, name: "Ada", ...fields };
}

export function aRole(fields: Partial<Role> = {}): Role {
  const hiredAt = new Date("2026-10-25T09:00:00.000Z");
  return {
    key: "developer",
    card: aRoleCard(),
    cardVersion: 1,
    hiredAt,
    cardSavedAt: hiredAt,
    ...fields,
  };
}
