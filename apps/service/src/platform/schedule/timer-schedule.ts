import { Logger, type BeforeApplicationShutdown } from "@nestjs/common";
import { Schedule, type ScheduledJob } from "./schedule.js";

/** The Office's clock: Node's timers, which never keep the process alive. */
export class TimerSchedule extends Schedule implements BeforeApplicationShutdown {
  private readonly logger = new Logger(Schedule.name);
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly running = new Set<Promise<void>>();
  private stopped = false;

  /** `dayMs` is how long a day is: shorter only where tests watch a daily job run. */
  constructor(private readonly dayMs: number) {
    super();
  }

  daily(name: string, job: ScheduledJob): void {
    this.runAfter(0, name, job);
  }

  /** Before the database closes, so no run is cut off halfway through its writes. */
  async beforeApplicationShutdown(): Promise<void> {
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    await Promise.all(this.running);
  }

  private runAfter(delayMs: number, name: string, job: ScheduledJob): void {
    if (this.stopped) return;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      const run = this.run(name, job).finally(() => {
        this.running.delete(run);
        this.runAfter(this.dayMs, name, job);
      });
      this.running.add(run);
    }, delayMs);
    timer.unref();
    this.timers.add(timer);
  }

  private async run(name: string, job: ScheduledJob): Promise<void> {
    try {
      await job();
    } catch (error) {
      this.logger.warn(`${name} failed: ${(error as Error).message}`);
    }
  }
}
