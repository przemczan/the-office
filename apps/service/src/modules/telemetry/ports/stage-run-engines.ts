import type { StatsStageRunEngines } from "../domain/full-stats.js";

/** The engines Pipelines kept for each Stage run; the composition root binds it. */
export abstract class StageRunEngines {
  /** Each Stage run of the Tasks that kept an engine. */
  abstract of(taskIds: readonly string[]): Promise<readonly StatsStageRunEngines[]>;
}
