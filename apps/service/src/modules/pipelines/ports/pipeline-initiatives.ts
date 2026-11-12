/** An Initiative that names a library Pipeline, as the library weighs who uses it. */
export interface PipelineInitiative {
  readonly name: string;
  readonly state: "shaping" | "active" | "done" | "dropped";
  readonly pipelineId: string;
  /** The Projects the Initiative spans. */
  readonly projectIds: readonly string[];
  /** Whether its Pipeline has started, in one of its Publishing Tasks. */
  readonly pipelineStarted: boolean;
}

/**
 * Work's Initiatives that have a Pipeline of their own (spec §2.1, "An Initiative's Pipeline"):
 * every one, whatever its state; the library counts only the shaping and active ones whose
 * Pipeline hasn't started.
 */
export abstract class PipelineInitiatives {
  abstract withPipelines(): Promise<readonly PipelineInitiative[]>;
}
