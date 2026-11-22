import type { ActivityEnvironmentCheck } from "../domain/activity.js";

/** Each Project's environment check, which Projects keeps; the composition root binds it. */
export abstract class ActivityEnvironmentChecks {
  /** For every Project, the check running now, or else its last finished one. */
  abstract latestOfAll(): Promise<readonly ActivityEnvironmentCheck[]>;
}
