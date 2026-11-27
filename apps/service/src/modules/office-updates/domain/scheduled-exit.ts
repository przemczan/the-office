import type { ScheduledExit } from "../../busy-work/index.js";
import type { OfficeUpdateTarget } from "./office-update-target.js";

/** The scheduled exit as Office updates schedules it: an update carries its target. */
export type OfficeScheduledExit = ScheduledExit<OfficeUpdateTarget>;
