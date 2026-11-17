import type { StatsStageRun } from "../domain/basic-stats.js";

/** The Stage runs Pipelines keeps; the composition root binds it. */
export abstract class StageRunTotals {
  /**
   * Every Stage run started at or after `since`, of any Task, with its tokens and whether its Stage
   * already had a run on the same Task, whenever that one started.
   */
  abstract since(since: Date): Promise<readonly StatsStageRun[]>;
}
