import type { ActivityTask } from "../domain/activity.js";

/** The Tasks, which Work keeps; the composition root binds it. */
export abstract class ActivityTasks {
  /** The Tasks at a desk: In progress, Waiting on you or Paused. */
  abstract started(): Promise<readonly ActivityTask[]>;
  /** The Tasks of these ids that Work knows, in no particular order. */
  abstract findAll(ids: readonly string[]): Promise<readonly ActivityTask[]>;
}
