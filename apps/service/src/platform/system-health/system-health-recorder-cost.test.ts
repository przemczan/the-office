import { describe, expect, it } from "vitest";
import { ManualSchedule } from "../schedule/schedule.fixtures.js";
import { NodeWorkstation } from "../workstation/workstation.js";
import { NodeOfficeProcess } from "./office-process.js";
import { HEALTH_READINGS_KEPT, SystemHealthRecorder } from "./system-health-recorder.js";

/** The monotonic clock moves on 5 s per reading, so each one measures as in production. */
class SteppingWorkstation extends NodeWorkstation {
  clock = 0;

  override monotonicMilliseconds(): number {
    return this.clock;
  }
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * Under the full suite's load one round can stall on the scheduler or a collection well past the
 * bound; a recorder that really grew slower is slow in every round, so the fastest one tells it.
 */
const MEASURED_ROUNDS = 3;

function fastestOf(rounds: number, work: () => void): number {
  let fastestMs = Number.POSITIVE_INFINITY;
  for (let round = 0; round < rounds; round += 1) {
    const startedAt = performance.now();
    work();
    fastestMs = Math.min(fastestMs, performance.now() - startedAt);
  }
  return fastestMs;
}

/**
 * The recorder must never be what slows The Office down (spec 5.2, System health, "Its cost").
 * On a 16-core machine a reading takes about 0.7 ms, most of it `os.cpus()`, which grows with the
 * cores; 10 000 queries take about 15 ms to record and the hour under 2 ms to give. The bounds
 * leave room for a busy CI runner with many cores, while a reading that grew to read files or
 * walk the hour, or a query shaped afresh each time, would not pass.
 */
describe("SystemHealthRecorder's cost", () => {
  it("takes a reading in under 5 ms, with the real process and workstation measured", () => {
    const workstation = new SteppingWorkstation();
    const officeProcess = new NodeOfficeProcess();
    const recorder = new SystemHealthRecorder(new ManualSchedule(), workstation, officeProcess);
    recorder.start();
    const durations: number[] = [];
    try {
      for (let reading = 0; reading < 200; reading += 1) {
        for (let request = 0; request < 50; request += 1) {
          recorder.recordRequest("GET", `/api/route-${request % 20}`, request);
          recorder.recordQuery(`select * from "t${request % 20}" where "id" = $1`, request / 10, 0);
        }
        workstation.clock += 5_000;
        const startedAt = performance.now();
        recorder.takeReading();
        durations.push(performance.now() - startedAt);
      }
    } finally {
      recorder.onModuleDestroy();
    }

    expect(median(durations)).toBeLessThan(5);
  });

  it("records 10 000 queries in under 100 ms and gives a full hour in under 50 ms", () => {
    const workstation = new SteppingWorkstation();
    const recorder = new SystemHealthRecorder(
      new ManualSchedule(),
      workstation,
      new NodeOfficeProcess(),
    );
    for (let reading = 0; reading < HEALTH_READINGS_KEPT; reading += 1) {
      recorder.recordRequest("GET", "/api/tasks", 3);
      workstation.clock += 5_000;
      recorder.takeReading();
    }

    const recordingMs = fastestOf(MEASURED_ROUNDS, () => {
      for (let query = 0; query < 10_000; query += 1) {
        recorder.recordQuery(
          `select "id", "title" from "tasks" where "project_id" = $1 and "id" in ($2, $3) -- ${query % 200}`,
          query % 50,
          query % 3,
        );
      }
    });
    const hourMs = fastestOf(MEASURED_ROUNDS, () => recorder.lastHour());

    expect(recordingMs).toBeLessThan(100);
    expect(hourMs).toBeLessThan(50);
  });

  it("records 10 000 queries told with their call stacks in under 100 ms, formatting few stacks", () => {
    let fastestMs = Number.POSITIVE_INFINITY;
    const stacksFormattedPerRound: number[] = [];
    // Each round on a fresh recorder, so every round formats the stacks a first round would.
    for (let round = 0; round < MEASURED_ROUNDS; round += 1) {
      const recorder = new SystemHealthRecorder(
        new ManualSchedule(),
        new SteppingWorkstation(),
        new NodeOfficeProcess(),
      );
      let stacksFormatted = 0;
      // As the database pool does: each call's frames collected, its stack formatted only if asked.
      // Collected before the clock starts, since collecting is the pool's cost, not the recorder's.
      const calls = Array.from({ length: 10_000 }, () => new Error("query called"));

      const recordingStartedAt = performance.now();
      for (const [query, call] of calls.entries()) {
        recorder.recordQuery(
          `select "id", "title" from "tasks" where "project_id" = $1 -- ${query % 200}`,
          query % 50,
          0,
          () => {
            stacksFormatted += 1;
            return call.stack;
          },
        );
      }
      fastestMs = Math.min(fastestMs, performance.now() - recordingStartedAt);
      stacksFormattedPerRound.push(stacksFormatted);
    }

    expect(fastestMs).toBeLessThan(100);
    // One shape called from one place, short of 3: only its first 20 stacks read.
    expect(stacksFormattedPerRound).toEqual(Array.from({ length: MEASURED_ROUNDS }, () => 20));
  });
});
