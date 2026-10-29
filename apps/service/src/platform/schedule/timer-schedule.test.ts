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

  it("goes on after a run fails", async () => {
    const schedule = new TimerSchedule(DAY_MS);
    const job = vi.fn<() => Promise<void>>(() => Promise.reject(new Error("Source offline")));

    schedule.daily("a job", job);
    await vi.advanceTimersByTimeAsync(DAY_MS);

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

  it("runs a wait once at its time, at once when its time has passed, and none called off", async () => {
    const schedule = new TimerSchedule(DAY_MS);
    const later = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const passed = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const calledOff = vi.fn<() => Promise<void>>(() => Promise.resolve());

    schedule.once("later", new Date(schedule.now().getTime() + 5_000), later);
    schedule.once("passed", new Date(schedule.now().getTime() - 5_000), passed);
    schedule.once("called off", new Date(schedule.now().getTime() + 1_000), calledOff).cancel();
    await vi.advanceTimersByTimeAsync(0);
    expect(passed).toHaveBeenCalledTimes(1);
    expect(later).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(DAY_MS * 10);

    expect(later).toHaveBeenCalledTimes(1);
    expect(calledOff).not.toHaveBeenCalled();
    await schedule.beforeApplicationShutdown();
  });

  it("waits longer than Node's timers take", async () => {
    const schedule = new TimerSchedule(DAY_MS);
    const job = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

    schedule.once("a month on", new Date(schedule.now().getTime() + thirtyDaysMs), job);
    await vi.advanceTimersByTimeAsync(thirtyDaysMs - 1);
    expect(job).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(job).toHaveBeenCalledTimes(1);
    await schedule.beforeApplicationShutdown();
  });
});
