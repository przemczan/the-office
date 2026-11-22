import type { OffBoardTaskOnNow } from "../domain/now.js";

/** The Off-board Tasks, which Work keeps; the composition root binds it. */
export abstract class OfficeOffBoardTasks {
  /** Undefined for no such Task, or one that isn't an Off-board Task. */
  abstract ofTask(taskId: string): Promise<OffBoardTaskOnNow | undefined>;
}
