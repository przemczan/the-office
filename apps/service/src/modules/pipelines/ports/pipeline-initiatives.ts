/**
 * An Initiative's Pipeline in one Project it spans, as the library weighs who uses a Pipeline: an
 * office-wide one or that Project's own Project Pipeline.
 */
export interface PipelineInitiative {
  readonly name: string;
  readonly state: "shaping" | "active" | "done" | "dropped";
  readonly projectId: string;
  readonly pipelineId: string;
  /** Whether its Pipeline has started there, in that Project's Publishing Task. */
  readonly pipelineStarted: boolean;
}

/**
 * Work's Initiatives' Pipelines (spec §2.1, "An Initiative's Pipeline"), one for each Project an
 * Initiative spans with a Pipeline, whatever its state; the library counts only the shaping and
 * active ones whose Pipeline hasn't started in that Project.
 */
export abstract class PipelineInitiatives {
  abstract withPipelines(): Promise<readonly PipelineInitiative[]>;
}
