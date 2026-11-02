/** The states the walk reads a Task in and moves it between. */
export type WalkTaskState = "in-progress" | "waiting-on-you" | "done" | "dropped";

/** What the walk reads of a Task. */
export interface StartedTask {
  readonly id: string;
  readonly state: string;
  readonly projectId: string;
  /** The library Pipeline the Task's own Stages are copied from. */
  readonly pipelineId: string;
  /** Whether the fire alarm holds it Paused, apart from the user's own Pause. */
  readonly pausedByAlarm: boolean;
}

/**
 * The started Tasks the Stage interpreter moves along, in Work. Bound to Work's TaskService, which
 * refuses to move a Task that hasn't started: only Start does that.
 */
export abstract class StartedTasks {
  abstract read(taskId: string): Promise<StartedTask>;

  /** Every Task, started or not: as The Office starts, it looks for runs left running among them. */
  abstract list(): Promise<readonly StartedTask[]>;

  /**
   * The Task as it is after the move. A Paused Task stays Paused: the user holds it, and only
   * Resume moves it on.
   */
  abstract changeState(taskId: string, state: WalkTaskState): Promise<StartedTask>;

  /**
   * Holds the Task Paused as the user's Pause does, for a reason the walk can't go on with; its
   * record names The Office and the reason.
   */
  abstract hold(taskId: string, reason: string): Promise<StartedTask>;

  /**
   * Pauses a Task In progress or Waiting on you as the fire alarm does, if the alarm is on: as The
   * Office starts again after stopping during a sounding. Whether the alarm is on.
   */
  abstract holdForFireAlarm(taskId: string): Promise<boolean>;

  /** Resumes a Paused Task, as the user's Resume does. */
  abstract resume(taskId: string): Promise<StartedTask>;

  /** Drops the Task, as the user does. */
  abstract drop(taskId: string): Promise<StartedTask>;
}
