import type { PlanningPipeline } from "../domain/planning.js";

/**
 * The library's Pipelines, which a Task may follow. A port rather than the Pipelines module itself,
 * because Pipelines' Stage interpreter will read Tasks: the composition root binds it.
 */
export abstract class KnownPipelines {
  abstract list(): Promise<readonly PlanningPipeline[]>;

  abstract find(id: string): Promise<PlanningPipeline | undefined>;
}
