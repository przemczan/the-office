import { Schedule, type ScheduledJob, type Wait } from "./schedule.js";

interface PendingWait {
  readonly name: string;
  readonly at: Date;
  readonly job: ScheduledJob;
}

/**
 * A schedule whose jobs run only when a test runs them, and fail the test when they fail. Its time
 * is the system's until a test sets it; then it moves only when the test moves it.
 */
export class ManualSchedule extends Schedule {
  private readonly jobs = new Map<string, ScheduledJob>();
  private readonly waits = new Set<PendingWait>();
  private time: Date | undefined;

  now(): Date {
    return new Date((this.time ?? new Date()).getTime());
  }

  daily(name: string, job: ScheduledJob): void {
    this.jobs.set(name, job);
  }

  once(name: string, at: Date, job: ScheduledJob): Wait {
    const wait = { name, at, job };
    this.waits.add(wait);
    return { cancel: () => void this.waits.delete(wait) };
  }

  /** Stops the clock at `at`, running nothing. */
  setTime(at: Date): void {
    this.time = at;
  }

  /**
   * Moves the clock to `at`, running each wait due by then in its time's order, the clock at that
   * time while it runs, and waiting for it; a wait set while they run runs too if it is due.
   */
  async advanceTo(at: Date): Promise<void> {
    for (let next = this.nextDue(at); next; next = this.nextDue(at)) {
      this.waits.delete(next);
      if (next.at.getTime() > this.now().getTime()) this.time = next.at;
      await next.job();
    }
    this.time = at;
  }

  /** Moves the clock on by `ms`, as `advanceTo` does. */
  advanceBy(ms: number): Promise<void> {
    return this.advanceTo(new Date(this.now().getTime() + ms));
  }

  /** Runs the job as its day's run would, and waits for it. */
  async runDaily(name: string): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`No daily job named ${name} was scheduled.`);
    await job();
  }

  private nextDue(by: Date): PendingWait | undefined {
    return [...this.waits]
      .filter(({ at }) => at.getTime() <= by.getTime())
      .toSorted((one, other) => one.at.getTime() - other.at.getTime())[0];
  }
}
