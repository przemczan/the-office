/**
 * Why a Task's checks can't run in its run environment: an invalid definition, or an image or
 * compose project that couldn't be made, each reason in the UI's words.
 */
export class RunEnvironmentRefused extends Error {
  constructor(
    readonly reasons: readonly string[],
    /** The file the failing step's output went to, when it got that far. */
    readonly outputFile?: string,
  ) {
    super(reasons.join(" "));
    this.name = "RunEnvironmentRefused";
  }
}
