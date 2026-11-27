import { PROJECT_OFFICE_ACTIONS } from "./ci-runs.js";
import { DEVICE_OFFICE_ACTIONS } from "./devices.js";
import { GITHUB_OFFICE_ACTIONS } from "./github.js";
import type { OfficeAction } from "./office-actions.js";
import { OFFICE_UPDATE_OFFICE_ACTIONS } from "./office-updates.js";
import { PEOPLE_OFFICE_ACTIONS } from "./people.js";
import { PIPELINES_OFFICE_ACTIONS } from "./pipelines.js";
import { TELEMETRY_OFFICE_ACTIONS } from "./stats.js";
import { TEST_INSTANCE_OFFICE_ACTIONS } from "./test-instances.js";
import { WORK_OFFICE_ACTIONS } from "./work.js";

/** Every declared Office action, each record's beside its contract. */
export const OFFICE_ACTIONS: readonly OfficeAction[] = [
  ...WORK_OFFICE_ACTIONS,
  ...PIPELINES_OFFICE_ACTIONS,
  ...PROJECT_OFFICE_ACTIONS,
  ...PEOPLE_OFFICE_ACTIONS,
  ...TEST_INSTANCE_OFFICE_ACTIONS,
  ...DEVICE_OFFICE_ACTIONS,
  ...OFFICE_UPDATE_OFFICE_ACTIONS,
  ...GITHUB_OFFICE_ACTIONS,
  ...TELEMETRY_OFFICE_ACTIONS,
];
