import { Schedule, type ScheduledJob } from "./schedule.js";

/** A schedule whose jobs run only when a test runs them, and fail the test when they fail. */
export class ManualSchedule extends Schedule {
  private readonly jobs = new Map<string, ScheduledJob>();

  daily(name: string, job: ScheduledJob): void {
    this.jobs.set(name, job);
  }

  /** Runs the job as its day's run would, and waits for it. */
  async runDaily(name: string): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`No daily job named ${name} was scheduled.`);
    await job();
  }
}
