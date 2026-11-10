import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimerSchedule } from "./timer-schedule.js";

const DAY_MS = 1000;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TimerSchedule", () => {
  it("runs a daily job at once, in the background, then a day after each run", async () => {
    const schedule = new TimerSchedule(DAY_MS);
    const job = vi.fn<() => Promise<void>>(() => Promise.resolve());

    schedule.daily("a job", job);
    expect(job).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(job).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DAY_MS - 1);
    expect(job).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(job).toHaveBeenCalledTimes(2);

    await schedule.beforeApplicationShutdown();
  });

  it("waits for a running job at shutdown, and runs none after", async () => {
    const schedule = new TimerSchedule(DAY_MS);
    const finishing: (() => void)[] = [];
    const job = vi.fn<() => Promise<void>>(
      () => new Promise((resolve) => void finishing.push(resolve)),
    );
    schedule.daily("a job", job);
    await vi.advanceTimersByTimeAsync(0);

    let shutDown = false;
    const shutdown = schedule.beforeApplicationShutdown().then(() => (shutDown = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(shutDown).toBe(false);
    for (const finish of finishing) finish();
    await shutdown;
    await vi.advanceTimersByTimeAsync(DAY_MS * 2);

    expect(job).toHaveBeenCalledTimes(1);
  });
});
