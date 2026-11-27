import type { TaskOutcome } from "../domain/task-outcome.js";

/** The started Tasks' outcomes, kept as they happen, since Work keeps only each Task's state. */
export abstract class TaskOutcomeRepository {
  abstract add(outcome: TaskOutcome): Promise<void>;
  /** The outcomes after the moment, in no particular order. */
  abstract since(at: Date): Promise<readonly TaskOutcome[]>;
  /** The failed outcomes from `start`, which is in, to `end`, which is not, in no particular order. */
  abstract failedBetween(start: Date, end: Date): Promise<readonly TaskOutcome[]>;
}
