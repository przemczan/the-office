/**
 * Starts a Task's run environment, which only pairing a phone over wireless debugging does (spec
 * §2.13, "The helper's start and stop"); it then stops when idle as usual.
 */
export abstract class RunEnvironmentStart {
  /** Every reason it couldn't start, in the UI's words; none once it runs. */
  abstract start(taskId: string, projectId: string): Promise<readonly string[]>;
}
