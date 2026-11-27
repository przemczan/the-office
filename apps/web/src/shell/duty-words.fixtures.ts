import type { Duty, DutyKey, Role } from "@the-office/contracts";

/** A Role with only what the duty words read: its key, name, title, Consultant and state. */
export function roleFor(
  key: string,
  name: string,
  title: string,
  { builtIn = false, letGo = false, consultant = true } = {},
): Role {
  return {
    key,
    card: { name, title, capabilities: { consultant } },
    builtIn,
    letGoAt: letGo ? "2026-11-14T09:00:00.000Z" : null,
  } as unknown as Role;
}

export const CARETAKER = roleFor("caretaker", "Toby", "Caretaker", { builtIn: true });
export const PLANNER = roleFor("planner", "Angela", "Planner");
export const DEVOPS = roleFor("devops", "Dwight", "Devops", { consultant: false });
export const DEVELOPER_LET_GO = roleFor("developer", "Jim", "Developer", { letGo: true });

/** The duty keyed `key`, set to `roleKey` and held by `holder`, else unheld with its fallback. */
export function dutyOf(
  key: DutyKey,
  label: string,
  roleKey: string | null,
  holder: Role | null,
): Duty {
  return {
    key,
    label,
    defaultRoleKey: roleKey ?? key,
    set: true,
    roleKey,
    holder: holder && {
      roleKey: holder.key,
      name: holder.card.name,
      title: holder.card.title,
    },
    fallback: holder ? null : "user",
    jobSettings: {},
    jobSettingsToGive: holder ? {} : null,
  };
}
