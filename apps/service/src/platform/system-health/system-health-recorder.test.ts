import { describe, expect, it } from "vitest";
import { HEALTH_READING_INTERVAL_MS, HEALTH_READING_JOB } from "./system-health-recorder.js";
import { recorderForTests, START } from "./system-health.fixtures.js";

describe("SystemHealthRecorder", () => {
  it("takes a Health reading of the process, the workstation and the 5 s of requests and queries", () => {
    const { recorder, workstation, officeProcess, pass } = recorderForTests();
    officeProcess.delay = { p99Ms: 12, maxMs: 40 };
    // 2.5 s of CPU over 5 s: half a core, a quarter of the two-core workstation.
    officeProcess.cpuMs = 2_500;
    workstation.total = workstation.total.map((total) => total + 5_000);
    workstation.idle = workstation.idle.map((idle) => idle + 2_500);
    for (const ms of [10, 20, 30, 40, 1_000]) recorder.recordRequest("GET", "/api/tasks/:id", ms);
    recorder.recordQuery('select "id" from "tasks" where "id" = $1', 4, 0);
    recorder.recordQuery('select "id" from "tasks" where "id" = $1', 6, 3);
    pass();

    const reading = recorder.takeReading();

    expect(reading).toEqual({
      at: new Date(START.getTime() + HEALTH_READING_INTERVAL_MS),
      eventLoopLagP99Ms: 12,
      eventLoopLagMaxMs: 40,
      officeCpuPercent: 50,
      officeCpuOfWorkstationPercent: 25,
      memoryInUseBytes: 300 * 1024 ** 2,
      heapUsedBytes: 120 * 1024 ** 2,
      workstationCpuPercent: 50,
      // 4 GiB of 16 GiB available.
      workstationMemoryPercent: 75,
      requests: 5,
      requestP95Ms: 1_000,
      queries: 2,
      queryP95Ms: expect.closeTo(6, 0) as number,
      connectionsWaiting: 3,
    });
  });

  it("closes each step: the next reading counts only what came after", () => {
    const { recorder, readingAfterAStep } = recorderForTests();
    recorder.recordRequest("GET", "/api/tasks", 5);
    readingAfterAStep();

    const next = readingAfterAStep();

    expect(next).toMatchObject({
      requests: 0,
      requestP95Ms: null,
      queries: 0,
      queryP95Ms: null,
      connectionsWaiting: 0,
    });
  });

  it("gives the last hour: its readings oldest first, its totals and its slowest routes and queries", () => {
    const { recorder, readingAfterAStep } = recorderForTests();
    recorder.recordRequest("GET", "/api/tasks/:id", 100);
    recorder.recordRequest("GET", null, 2);
    recorder.recordQuery("SELECT * FROM stage_runs WHERE id IN ($1, $2, $3)", 30, 0);
    const first = readingAfterAStep();
    recorder.recordRequest("POST", "/api/tasks", 50);
    recorder.recordQuery("INSERT INTO tasks (id, title) VALUES ($1, $2), ($3, $4)", 8, 0);
    const second = readingAfterAStep();

    const hour = recorder.lastHour();

    expect(hour.readingsSince).toEqual(START);
    expect(hour.readings).toEqual([first, second]);
    expect(hour).toMatchObject({ requests: 3, queries: 2 });
    expect(hour.requestP95Ms).toBeCloseTo(100, 0);
    expect(hour.slowestRoutes).toEqual([
      expect.objectContaining({ route: { method: "GET", template: "/api/tasks/:id" }, count: 1 }),
      expect.objectContaining({ route: { method: "POST", template: "/api/tasks" }, totalMs: 50 }),
      expect.objectContaining({ route: null, count: 1, maxMs: 2 }),
    ]);
    expect(hour.slowestQueries).toEqual([
      {
        operation: "SELECT",
        table: "stage_runs",
        shape: "SELECT * FROM stage_runs WHERE id IN (?)",
        count: 1,
        p95Ms: 30,
        maxMs: 30,
        totalMs: 30,
      },
      expect.objectContaining({
        operation: "INSERT",
        table: "tasks",
        shape: "INSERT INTO tasks (id, title) VALUES (?)",
      }),
    ]);
  });

  it("takes a reading every 5 s on the Schedule once the app starts, and none a moment after the last", async () => {
    const { recorder, schedule, officeProcess, pass } = recorderForTests();
    recorder.onApplicationBootstrap();
    expect(officeProcess.started).toBe(true);
    expect(schedule.intervalOf(HEALTH_READING_JOB)).toBe(HEALTH_READING_INTERVAL_MS);

    // The Schedule runs the job once straight away: too soon to measure anything.
    await schedule.runRepeating(HEALTH_READING_JOB);
    expect(recorder.latestReading()).toBeUndefined();
    pass();
    await schedule.runRepeating(HEALTH_READING_JOB);
    expect(recorder.latestReading()).toBeDefined();

    recorder.onModuleDestroy();
    expect(officeProcess.started).toBe(false);
  });

  it("tells each query's operation, table and duration to its listeners", () => {
    const { recorder } = recorderForTests();
    const told: unknown[] = [];
    const stop = recorder.onQuery((...query) => told.push(query));

    recorder.recordQuery('update "tasks" set "title" = $1 where "id" = $2', 3, 0);
    stop();
    recorder.recordQuery("select 1", 1, 0);

    expect(told).toEqual([["UPDATE", "tasks", 3]]);
  });
});
