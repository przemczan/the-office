import type { ActivityActionRun } from "../domain/activity.js";

/** The Action runs, which Actions keeps; the composition root binds it. */
export abstract class ActivityActionRuns {
  /** The Project command runs running now. */
  abstract runningCommandRuns(): Promise<readonly ActivityActionRun[]>;
}
