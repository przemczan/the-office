/** The states the walk reads a Task in and moves it between. */
export type WalkTaskState = "in-progress" | "waiting-on-you" | "done" | "dropped";

/** What the walk reads of a Task. */
export interface StartedTask {
  readonly id: string;
  readonly state: string;
  readonly projectId: string;
  /**
   * The library Pipeline the Task's own Stages are copied from; undefined until one is chosen,
   * which it is before the Task can be Ready, so a started Task always has one.
   */
  readonly pipelineId: string | undefined;
  /**
   * What holds it Paused apart from the user's own Pause: `alarm` for the fire alarm, `initiative`
   * for its Initiative's Pause, `usage-window` for its engine's usage window used up; undefined for
   * none.
   */
  readonly pausedBy: string | undefined;
  /** What The Office made it for, such as `publishing` for a Publishing Task; undefined for most. */
  readonly madeFor?: string | undefined;
}

/**
 * A Stage's turn its engine refused because a usage window of its account is used up: the engine,
 * its name, the window by the engine module's name for it, and its reset, when the Task resumes.
 */
export interface UsageWindowRefusal {
  readonly engineId: string;
  readonly engineName: string;
  readonly window: string;
  readonly resetsAt: Date;
}

/** A Task another waits for, as the walk names it. */
export interface TaskBlocker {
  readonly id: string;
  readonly title: string;
}

/**
 * Who a Resume or a Drop is recorded by, as Work's records keep them: the user who answered the
 * Decision that asked for it (`user` null when the answer doesn't say which user gave it), or the
 * Consultant who answered it, by their Role's key.
 */
export type ResumedOrDroppedBy =
  | {
      readonly kind: "user";
      readonly user: { readonly userId: string; readonly name: string } | null;
    }
  | { readonly kind: "person"; readonly roleKey: string };

/**
 * The started Tasks the Stage interpreter moves along, in Work. Bound to Work's TaskService, which
 * refuses to move a Task that hasn't started: only Start does that.
 */
export abstract class StartedTasks {
  abstract read(taskId: string): Promise<StartedTask>;

  /** The Task, archived ones too, or undefined when The Office has none of that id. */
  abstract find(taskId: string): Promise<StartedTask | undefined>;

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

  /**
   * Pauses the Task by the usage window until its reset, when it resumes by itself (spec 2.1, "A
   * pause by the usage window"); one paused by it already has its resume moved on. Its running
   * Stage isn't asked to pause: the Stage runner ends the run held itself.
   */
  abstract pauseForUsageWindow(taskId: string, refusal: UsageWindowRefusal): Promise<StartedTask>;

  /** Resumes a Paused Task, as the user's Resume does. */
  abstract resume(taskId: string, by: ResumedOrDroppedBy): Promise<StartedTask>;

  /** Drops the Task, as the user does. */
  abstract drop(taskId: string, by: ResumedOrDroppedBy): Promise<StartedTask>;

  /**
   * The Tasks still holding the Task back, neither Done nor Dropped: a started Publishing Task waits
   * for them before its next Stage (spec 2.1, "Publishing Tasks").
   */
  abstract waitingFor(taskId: string): Promise<readonly TaskBlocker[]>;

  /**
   * Publish landed the Task's commit message, as one commit or a pull request: from now on it no
   * longer changes (spec §2.3, "The Task's commit message").
   */
  abstract markCommitMessagePublished(taskId: string): Promise<unknown>;
}
