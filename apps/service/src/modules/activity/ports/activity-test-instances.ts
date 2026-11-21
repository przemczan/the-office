import type { ActivityTestInstance } from "../domain/activity.js";

/** The test instances, which Test instances keeps; the composition root binds it. */
export abstract class ActivityTestInstances {
  /** Those Building or Running, and those Built or Failed at or after `since`. */
  abstract activity(since: Date): Promise<readonly ActivityTestInstance[]>;
}
