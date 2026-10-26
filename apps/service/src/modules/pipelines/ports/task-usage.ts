/**
 * What each Task's sessions have used, which Conversations counts; the composition root binds it.
 * The Stage interpreter checks every Stage's budget against it before each engine call.
 */
export abstract class TaskUsage {
  /** All of the Task's tokens so far, of all four kinds, as its Threads show them. */
  abstract tokensSoFar(taskId: string): Promise<number>;
}
