import type { Duty } from "@the-office/contracts";
import type { DutyWithHolder } from "../../application/duties.js";

/** A duty as the web reads it. */
export function toDutyResponse(duty: DutyWithHolder): Duty {
  return {
    key: duty.duty,
    label: duty.label,
    defaultRoleKey: duty.defaultRoleKey,
    set: duty.set,
    roleKey: duty.roleKey,
    holder: duty.holder && { ...duty.holder },
    fallback: duty.fallback,
    jobSettings: duty.jobSettings,
    jobSettingsToGive: duty.jobSettingsToGive,
  };
}
