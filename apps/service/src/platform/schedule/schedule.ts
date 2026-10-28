/** A job The Office runs by itself, such as the daily check of skills' Sources. */
export type ScheduledJob = () => Promise<void>;

/**
 * When The Office runs its own jobs. A port, so tests run a job when they choose instead of
 * waiting for the clock.
 */
export abstract class Schedule {
  /**
   * Runs `job` soon, in the background, then once a day after each run ends. A run that fails is
   * logged and the next one goes ahead. `name` says which job it is in the logs.
   */
  abstract daily(name: string, job: ScheduledJob): void;
}
