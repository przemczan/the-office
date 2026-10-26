/** What changed on each started Task's branch, as git tells it. */
export abstract class TaskDiffs {
  /** A few lines of what changed so far; undefined when it isn't known. */
  abstract summaryOf(taskId: string): Promise<string | undefined>;
}
