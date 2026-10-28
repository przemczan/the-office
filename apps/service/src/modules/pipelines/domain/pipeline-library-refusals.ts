/** A library Pipeline that can't be removed now, with every reason, in the UI's words. */
export class PipelineRemovalRefused extends Error {
  constructor(readonly reasons: readonly string[]) {
    super(reasons.join(" "));
    this.name = "PipelineRemovalRefused";
  }
}

/** The library has no Pipeline by this id. */
export class UnknownPipeline extends Error {
  constructor(readonly pipelineId: string) {
    super(`There is no Pipeline "${pipelineId}".`);
    this.name = "UnknownPipeline";
  }
}
