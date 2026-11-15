import type { OfficeUpdateTarget } from "./office-update-target.js";

/**
 * What the service is to exit for once nothing is busy: an Office update to its target, or an
 * Office restart. Either holds new work the same way until it is cancelled or the service exits.
 */
export type ScheduledExit =
  | {
      readonly kind: "update";
      readonly target: OfficeUpdateTarget;
      readonly scheduledAt: Date;
    }
  | { readonly kind: "restart"; readonly scheduledAt: Date };

export type ScheduledExitKind = ScheduledExit["kind"];
