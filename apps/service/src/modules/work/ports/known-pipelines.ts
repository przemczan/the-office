import type { PipelineCommands } from "../domain/pipeline-commands.js";
import type { PlanningPipeline } from "../domain/planning.js";
import type { PipelineStage } from "../domain/usage-estimate.js";

/**
 * The Pipelines a Task may follow: the office-wide ones and each Project's own. A port rather than
 * the Pipelines module itself, because Pipelines' Stage interpreter will read Tasks: the
 * composition root binds it.
 */
export abstract class KnownPipelines {
  /** The office-wide Pipelines only, which Shaping and an Initiative's Pipeline choose from. */
  abstract list(): Promise<readonly PlanningPipeline[]>;

  /** The Project's own Pipelines, then the office-wide ones: what a Task of the Project chooses from. */
  abstract listFor(projectId: string): Promise<readonly PlanningPipeline[]>;

  /** An office-wide Pipeline; never a Project Pipeline. */
  abstract find(id: string): Promise<KnownPipeline | undefined>;

  /** An office-wide Pipeline or a Project Pipeline of any Project, built, carrying its Project. */
  abstract read(id: string): Promise<KnownPipeline | undefined>;

  /**
   * The Pipeline's name and the command keys its Stages run, a Project Pipeline's built Stages, with
   * its Project and why it is Broken; undefined for one neither the library nor a Project has.
   */
  abstract commandsNamedBy(id: string): Promise<PipelineCommands | undefined>;
}

/** A Pipeline with its Stages' keys and Roles, which a Usage estimate is made of. */
export interface KnownPipeline extends PlanningPipeline {
  readonly stages: readonly PipelineStage[];
}
