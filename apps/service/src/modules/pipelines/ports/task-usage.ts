/**
 * What each Task's sessions have used, which Conversations counts; the composition root binds it.
 * The Stage interpreter checks every Stage's budget against it before each engine call.
 */
export abstract class TaskUsage {
  /** All of the Task's tokens so far, input, output and cache writes: cache reads are left out. */
  abstract budgetTokensSoFar(taskId: string): Promise<number>;
}
