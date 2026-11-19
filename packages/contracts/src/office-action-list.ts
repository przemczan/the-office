import { PROJECT_OFFICE_ACTIONS } from "./ci-runs.js";
import type { OfficeAction } from "./office-actions.js";
import { WORK_OFFICE_ACTIONS } from "./work.js";

/** Every declared Office action, each record's beside its contract. */
export const OFFICE_ACTIONS: readonly OfficeAction[] = [
  ...WORK_OFFICE_ACTIONS,
  ...PROJECT_OFFICE_ACTIONS,
];
