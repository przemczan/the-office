/**
 * What the service is to exit for once nothing is busy: an Office update to its target, or an
 * Office restart. Either holds new work the same way until it is cancelled or the service exits.
 * The target is the one scheduling it, which Busy work never reads.
 */
export type ScheduledExit<Target = unknown> =
  | {
      readonly kind: "update";
      readonly target: Target;
      readonly scheduledAt: Date;
    }
  | { readonly kind: "restart"; readonly scheduledAt: Date };

export type ScheduledExitKind = ScheduledExit["kind"];
