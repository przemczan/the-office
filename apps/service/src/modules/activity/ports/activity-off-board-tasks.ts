import type { ActivityOffBoardTask } from "../domain/activity.js";

/** The Off-board Tasks, which Work keeps; the composition root binds it. */
export abstract class ActivityOffBoardTasks {
  /** Every Off-board Task off the Archive. */
  abstract listAll(): Promise<readonly ActivityOffBoardTask[]>;
}
