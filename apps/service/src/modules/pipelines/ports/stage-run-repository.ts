import type { StageRun } from "../domain/stage-run.js";

/** Where each Task's Stage runs are kept. */
export abstract class StageRunRepository {
  /**
   * Saves a run that has just started; false when the Task already has a run of that number, so two
   * walks of one Task can't both go on.
   */
  abstract saveNew(run: StageRun): Promise<boolean>;

  /** Saves how the run ended. */
  abstract saveEnded(run: StageRun): Promise<void>;

  /** The Task's runs, oldest first. */
  abstract list(taskId: string): Promise<readonly StageRun[]>;
}
