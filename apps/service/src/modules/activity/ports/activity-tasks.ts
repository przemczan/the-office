import type { ActivityStateChange, ActivityTask } from "../domain/activity.js";

/** The Tasks, which Work keeps; the composition root binds it. */
export abstract class ActivityTasks {
  /** The Tasks at a desk: In progress, Waiting on you or Paused. */
  abstract started(): Promise<readonly ActivityTask[]>;
  /** The ids of the Tasks that moved to Done at or after `since`. */
  abstract doneSince(since: Date): Promise<readonly string[]>;
  /** The Tasks of these ids that Work knows, in no particular order. */
  abstract findAll(ids: readonly string[]): Promise<readonly ActivityTask[]>;
  /** The Task's kept state changes, oldest first. */
  abstract stateChangesOf(taskId: string): Promise<readonly ActivityStateChange[]>;
}
