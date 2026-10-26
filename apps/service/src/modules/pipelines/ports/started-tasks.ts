/** The states the walk reads a Task in and moves it between. */
export type WalkTaskState = "in-progress" | "waiting-on-you" | "done" | "dropped";

/** What the walk reads of a Task. */
export interface StartedTask {
  readonly state: string;
  /** The library Pipeline the Task's own Stages are copied from. */
  readonly pipelineId: string;
}

/**
 * The started Tasks the Stage interpreter moves along, in Work. Bound to Work's TaskService, which
 * refuses to move a Task that hasn't started: only Start does that.
 */
export abstract class StartedTasks {
  abstract read(taskId: string): Promise<StartedTask>;

  abstract changeState(taskId: string, state: WalkTaskState): Promise<unknown>;
}
