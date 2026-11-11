import type { PipelineCommands } from "../domain/pipeline-commands.js";
import type { PlanningPipeline } from "../domain/planning.js";
import type { PipelineStage } from "../domain/usage-estimate.js";

/**
 * The library's Pipelines, which a Task may follow. A port rather than the Pipelines module itself,
 * because Pipelines' Stage interpreter will read Tasks: the composition root binds it.
 */
export abstract class KnownPipelines {
  abstract list(): Promise<readonly PlanningPipeline[]>;

  abstract find(id: string): Promise<KnownPipeline | undefined>;

  /** The Pipeline's name and the command keys its Stages run; undefined for one the library lacks. */
  abstract commandsNamedBy(id: string): Promise<PipelineCommands | undefined>;
}

/** A Pipeline with its Stages' keys and Roles, which a Usage estimate is made of. */
export interface KnownPipeline extends PlanningPipeline {
  readonly stages: readonly PipelineStage[];
}
