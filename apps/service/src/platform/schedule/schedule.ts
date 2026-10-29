/** A job The Office runs by itself, such as the daily check of skills' Sources. */
export type ScheduledJob = () => Promise<void>;

/** A job waiting for its time, which can be called off until it runs. */
export interface Wait {
  cancel(): void;
}

/**
 * The Office's clock: the time, and when The Office runs its own jobs. A port, so tests set the
 * time and run a job when they choose instead of waiting for the clock.
 */
export abstract class Schedule {
  /** The time now, as The Office's own jobs and waits see it. */
  abstract now(): Date;

  /**
   * Runs `job` soon, in the background, then once a day after each run ends. A run that fails is
   * logged and the next one goes ahead. `name` says which job it is in the logs.
   */
  abstract daily(name: string, job: ScheduledJob): void;

  /**
   * Runs `job` once at `at`, in the background, or soon when `at` has passed. A run that fails is
   * logged. Waits are kept in memory: whoever sets them sets them again at boot.
   */
  abstract once(name: string, at: Date, job: ScheduledJob): Wait;
}
