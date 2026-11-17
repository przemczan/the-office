import type { StatsStageRunSpan } from "../domain/full-stats.js";

/** The Agent Stage runs Pipelines keeps; the composition root binds it. */
export abstract class RunningStageRuns {
  /** The Agent Stage runs that ran at some time between `from` and `to`, oldest first. */
  abstract between(from: Date, to: Date): Promise<readonly StatsStageRunSpan[]>;
}
