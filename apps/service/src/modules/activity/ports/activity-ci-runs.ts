import type { ActivityCiRun } from "../domain/activity.js";

/** Each Project's recent CI runs, which Projects' watch keeps; the composition root binds it. */
export abstract class ActivityCiRuns {
  abstract list(): { readonly runs: readonly ActivityCiRun[] };
}
