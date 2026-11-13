/**
 * The Tasks' Gates, which the Pipelines module walks. A port rather than that module itself,
 * because Pipelines calls Work: the composition root binds it.
 */
export abstract class TaskGates {
  /**
   * When the run of the last Gate on the Task the user acted on ended, which is when the Task
   * reached it; undefined while the user has acted at none.
   */
  abstract lastActedOnGateEnd(taskId: string): Promise<Date | undefined>;
}
