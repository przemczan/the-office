import { Logger, type BeforeApplicationShutdown } from "@nestjs/common";
import { Schedule, type ScheduledJob, type Wait } from "./schedule.js";

/** Node's timers take at most this long (about 24.8 days); a longer wait is armed again. */
const LONGEST_TIMER_MS = 2 ** 31 - 1;

/** The Office's clock: the system's time and Node's timers, which never keep the process alive. */
export class TimerSchedule extends Schedule implements BeforeApplicationShutdown {
  private readonly logger = new Logger(Schedule.name);
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly running = new Set<Promise<void>>();
  private stopped = false;

  /** `dayMs` is how long a day is for daily jobs: shorter only where tests watch one run. */
  constructor(private readonly dayMs: number) {
    super();
  }

  now(): Date {
    return new Date();
  }

  daily(name: string, job: ScheduledJob): void {
    this.every(name, this.dayMs, job);
  }

  every(name: string, intervalMs: number, job: ScheduledJob): void {
    const runEvery = (delayMs: number): void => {
      this.runAfter(delayMs, name, job, () => runEvery(intervalMs));
    };
    runEvery(0);
  }

  once(name: string, at: Date, job: ScheduledJob): Wait {
    let timer: NodeJS.Timeout | undefined;
    const arm = (): void => {
      const delayMs = at.getTime() - Date.now();
      timer =
        delayMs > LONGEST_TIMER_MS
          ? this.timerAfter(LONGEST_TIMER_MS, arm)
          : this.runAfter(Math.max(0, delayMs), name, job, () => undefined);
    };
    arm();
    return {
      cancel: () => {
        if (!timer) return;
        clearTimeout(timer);
        this.timers.delete(timer);
      },
    };
  }

  /** Before the database closes, so no run is cut off halfway through its writes. */
  async beforeApplicationShutdown(): Promise<void> {
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    await Promise.all(this.running);
  }

  private runAfter(
    delayMs: number,
    name: string,
    job: ScheduledJob,
    afterRun: () => void,
  ): NodeJS.Timeout | undefined {
    return this.timerAfter(delayMs, () => {
      const run = this.run(name, job).finally(() => {
        this.running.delete(run);
        afterRun();
      });
      this.running.add(run);
    });
  }

  private timerAfter(delayMs: number, fire: () => void): NodeJS.Timeout | undefined {
    if (this.stopped) return undefined;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fire();
    }, delayMs);
    timer.unref();
    this.timers.add(timer);
    return timer;
  }

  private async run(name: string, job: ScheduledJob): Promise<void> {
    try {
      await job();
    } catch (error) {
      this.logger.warn(`${name} failed: ${(error as Error).message}`);
    }
  }
}
