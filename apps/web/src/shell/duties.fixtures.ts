import type { Duty, DutyFallback, DutyKey } from "@the-office/contracts";

const LABELS: Readonly<Record<DutyKey, string>> = {
  "default-person-to-talk-to": "Default person to talk to",
  "shapes-initiatives": "Shapes Initiatives",
  "asked-first-when-out-of-tries": "Asked first when out of tries",
  "onboards-projects": "Onboards and repairs Projects",
  "mcp-tool-consultant": "MCP tool consultant",
  plans: "Plans",
  implements: "Implements",
  reviews: "Reviews",
};

/** A duty held by the Role keyed `roleKey`, or by nobody with `fallback` applying. */
export function aDuty(key: DutyKey, roleKey: string | null, fallback: DutyFallback = "user"): Duty {
  return {
    key,
    label: LABELS[key],
    defaultRoleKey: key,
    set: true,
    roleKey,
    holder: roleKey === null ? null : { roleKey, name: roleKey, title: roleKey },
    fallback: roleKey === null ? fallback : null,
    jobSettings: {},
    jobSettingsToGive: roleKey === null ? null : {},
  };
}
