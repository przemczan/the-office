import { SYSTEM_HEALTH_KEPT_ROWS } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { DurationHistogram } from "./duration-histogram.js";
import { HEALTH_READINGS_KEPT } from "./system-health-recorder.js";
import { recorderForTests } from "./system-health.fixtures.js";

describe("SystemHealthRecorder, edge cases", () => {
  it("keeps an hour of 720 readings: the 721st drops the first", () => {
    const { recorder, readingAfterAStep } = recorderForTests();
    const readings = Array.from({ length: HEALTH_READINGS_KEPT + 1 }, () => readingAfterAStep());

    const { readings: kept } = recorder.lastHour();

    expect(kept).toHaveLength(HEALTH_READINGS_KEPT);
    expect(kept[0]).toBe(readings[1]);
    expect(kept.at(-1)).toBe(readings.at(-1));
    expect(recorder.latestReading()).toBe(readings.at(-1));
  });

  it("counts the hour's requests and queries only over the readings it keeps", () => {
    const { recorder, readingAfterAStep } = recorderForTests();
    recorder.recordRequest("GET", "/api/tasks", 1);
    readingAfterAStep();
    for (let step = 0; step < HEALTH_READINGS_KEPT; step += 1) {
      recorder.recordRequest("GET", "/api/tasks", 1);
      readingAfterAStep();
    }

    expect(recorder.lastHour().requests).toBe(HEALTH_READINGS_KEPT);
  });

  it("forgets a route an hour after it was last seen, minute by minute", () => {
    const { recorder, pass } = recorderForTests();
    recorder.recordRequest("GET", "/api/old", 10);
    pass(30 * 60_000);
    recorder.recordRequest("GET", "/api/old", 20);
    recorder.recordRequest("GET", "/api/recent", 5);
    pass(31 * 60_000);

    const routes = recorder.lastHour().slowestRoutes;

    expect(routes).toEqual([
      {
        route: { method: "GET", template: "/api/old" },
        count: 1,
        p95Ms: 20,
        maxMs: 20,
        totalMs: 20,
      },
      {
        route: { method: "GET", template: "/api/recent" },
        count: 1,
        p95Ms: 5,
        maxMs: 5,
        totalMs: 5,
      },
    ]);
    pass(30 * 60_000);
    expect(recorder.lastHour().slowestRoutes).toEqual([]);
  });

  it("keeps at most 500 statement shapes, dropping the least seen for a new one", () => {
    const { recorder } = recorderForTests();
    for (let table = 0; table < SYSTEM_HEALTH_KEPT_ROWS; table += 1) {
      recorder.recordQuery(`select * from t${table}`, 1, 0);
      // Every table but t7 is seen twice.
      if (table !== 7) recorder.recordQuery(`select * from t${table}`, 1, 0);
    }

    recorder.recordQuery("select * from newcomer", 1, 0);

    const tables = recorder.lastHour().slowestQueries.map(({ table }) => table);
    expect(tables).toHaveLength(SYSTEM_HEALTH_KEPT_ROWS);
    expect(tables).toContain("newcomer");
    expect(tables).not.toContain("t7");
  });

  it("keeps at most 500 routes, Unmatched among them", () => {
    const { recorder } = recorderForTests();
    recorder.recordRequest("GET", null, 1);
    recorder.recordRequest("GET", null, 1);
    for (let route = 0; route < SYSTEM_HEALTH_KEPT_ROWS + 10; route += 1) {
      recorder.recordRequest("GET", `/api/r${route}`, 1);
    }

    const routes = recorder.lastHour().slowestRoutes;
    expect(routes).toHaveLength(SYSTEM_HEALTH_KEPT_ROWS);
    expect(routes.some(({ route }) => route === null)).toBe(true);
  });

  it("has no workstation CPU when the cores changed between readings", () => {
    const { workstation, readingAfterAStep } = recorderForTests();
    workstation.total = [...workstation.total, 1000];
    workstation.idle = [...workstation.idle, 1000];

    expect(readingAfterAStep()?.workstationCpuPercent).toBeNull();
  });
});

describe("DurationHistogram", () => {
  it("gives a p95 within a bucket's width of the exact one, never above the longest", () => {
    const histogram = new DurationHistogram();
    for (let ms = 1; ms <= 1_000; ms += 1) histogram.add(ms);

    expect(histogram.percentile(95)).toBeGreaterThanOrEqual(950);
    expect(histogram.percentile(95)).toBeLessThanOrEqual(950 * 1.1);
    expect(histogram.percentile(100)).toBe(1_000);
    expect(histogram).toMatchObject({ count: 1_000, max: 1_000, sumMs: 500_500 });
  });

  it("merges into the same percentiles as one histogram of everything", () => {
    const whole = new DurationHistogram();
    const merged = new DurationHistogram();
    const parts = [new DurationHistogram(), new DurationHistogram()];
    for (let ms = 0; ms < 500; ms += 1) {
      const duration = (ms * 7) % 300;
      whole.add(duration);
      parts[ms % 2]?.add(duration);
    }
    for (const part of parts) merged.merge(part);

    expect(merged.percentile(95)).toBe(whole.percentile(95));
    expect(merged.count).toBe(whole.count);
  });

  it("has no percentile when nothing went in, and counts zero durations", () => {
    const histogram = new DurationHistogram();
    expect(histogram.percentile(95)).toBeNull();
    histogram.add(0);
    expect(histogram.percentile(95)).toBe(0);
  });
});
