import { describe, expect, it } from "vitest";
import {
  grafanaFiguresOf,
  healthSpanOf,
  holdsNoHealthData,
  lastHourFiguresOf,
  type HealthHour,
  type HealthHourReading,
  type HealthSeries,
} from "./system-health.js";

const NOW = new Date("2026-11-17T10:25:00.000Z");

function aReading(fields: Partial<HealthHourReading> = {}): HealthHourReading {
  return {
    at: new Date("2026-11-17T10:24:55.000Z"),
    eventLoopLagP99Ms: 9.1,
    eventLoopLagMaxMs: 12,
    officeCpuPercent: 23,
    officeCpuOfWorkstationPercent: 2.875,
    memoryInUseBytes: 300_000_000,
    heapUsedBytes: 120_000_000,
    workstationCpuPercent: 40,
    workstationMemoryPercent: 61,
    requests: 3,
    requestP95Ms: 46,
    queries: 10,
    queryP95Ms: 9.8,
    connectionsWaiting: 0,
    ...fields,
  };
}

const at = (iso: string) => new Date(iso);

describe("System health's span", () => {
  it("ends now and goes by the range's step: 5 s, 5 min, the hour, 6 h", () => {
    expect(healthSpanOf("1h", NOW)).toEqual({
      from: at("2026-11-17T09:25:00.000Z"),
      to: NOW,
      stepMs: 5_000,
    });
    expect(healthSpanOf("24h", NOW).stepMs).toBe(300_000);
    expect(healthSpanOf("7d", NOW)).toMatchObject({
      from: at("2026-11-10T10:25:00.000Z"),
      stepMs: 3_600_000,
    });
    expect(healthSpanOf("30d", NOW).stepMs).toBe(21_600_000);
  });
});

describe("the last hour's figures", () => {
  it("gives each reading its point, its requests and queries a minute, the slowest first", () => {
    const hour: HealthHour = {
      readingsSince: at("2026-11-17T09:12:00.000Z"),
      readings: [aReading({ workstationCpuPercent: null })],
      requests: 3,
      requestP95Ms: 46,
      queries: 10,
      queryP95Ms: 9.8,
      slowestRoutes: [
        { route: null, count: 1, p95Ms: 2, maxMs: 2, totalMs: 2 },
        {
          route: { method: "GET", template: "/api/tasks/:id" },
          count: 2,
          p95Ms: 40,
          maxMs: 50,
          totalMs: 80,
        },
      ],
      slowestQueries: [
        {
          operation: "SELECT",
          table: "tasks",
          shape: "SELECT * FROM tasks WHERE id = ?",
          calledFrom: [],
          count: 10,
          p95Ms: 9.8,
          maxMs: 11,
          totalMs: 60,
        },
      ],
    };

    const figures = lastHourFiguresOf(hour);

    expect(figures.points).toEqual([
      {
        at: at("2026-11-17T10:24:55.000Z"),
        eventLoopLagP99Ms: 9.1,
        eventLoopLagMaxMs: 12,
        officeCpuPercent: 23,
        officeCpuOfWorkstationPercent: 2.875,
        memoryInUseBytes: 300_000_000,
        heapUsedBytes: 120_000_000,
        workstationCpuPercent: null,
        workstationMemoryPercent: 61,
        requestsPerMinute: 36,
        requestP95Ms: 46,
        queriesPerMinute: 120,
        queryP95Ms: 9.8,
        connectionsWaiting: 0,
      },
    ]);
    expect(figures.slowestRoutes.map(({ route }) => route?.template ?? "Unmatched")).toEqual([
      "/api/tasks/:id",
      "Unmatched",
    ]);
    expect(figures.slowestQueries[0]?.shape).toBe("SELECT * FROM tasks WHERE id = ?");
    expect(figures).toMatchObject({ requests: 3, requestP95Ms: 46, queries: 10, queryP95Ms: 9.8 });
  });
});

describe("a longer range's figures from Grafana", () => {
  const span = {
    from: at("2026-11-17T10:00:00.000Z"),
    to: at("2026-11-17T10:15:00.000Z"),
    stepMs: 300_000,
  };

  it("joins the blocks by step, each point at its step's end, leaving a step with nothing out", () => {
    const series: Partial<HealthSeries> = {
      responsiveness: {
        lagP99Ms: [
          { at: at("2026-11-17T10:00:00.000Z"), value: 8 },
          { at: at("2026-11-17T10:10:00.000Z"), value: 120 },
        ],
        lagMaxMs: [{ at: at("2026-11-17T10:10:00.000Z"), value: 842 }],
      },
      database: {
        perMinute: [{ at: at("2026-11-17T10:00:00.000Z"), value: 40.4 }],
        p95Ms: [],
        connectionsWaiting: [{ at: at("2026-11-17T10:00:00.000Z"), value: 2.6 }],
        total: 1201.7,
        totalP95Ms: 9.8,
        slowest: [
          { operation: "SELECT", table: "tasks", count: 10.4, p95Ms: 5, maxMs: 10, totalMs: 30 },
          { operation: "INSERT", table: "threads", count: 2, p95Ms: 20, maxMs: 25, totalMs: 45 },
        ],
      },
    };

    const figures = grafanaFiguresOf(series, span);

    expect(figures.points.map((point) => point.at)).toEqual([
      at("2026-11-17T10:05:00.000Z"),
      at("2026-11-17T10:15:00.000Z"),
    ]);
    expect(figures.points[0]).toMatchObject({
      eventLoopLagP99Ms: 8,
      eventLoopLagMaxMs: null,
      queriesPerMinute: 40.4,
      connectionsWaiting: 3,
      // The blocks not read are null throughout.
      officeCpuPercent: null,
      requestsPerMinute: null,
    });
    expect(figures.points[1]).toMatchObject({ eventLoopLagP99Ms: 120, eventLoopLagMaxMs: 842 });
    expect(figures).toMatchObject({ requests: 0, requestP95Ms: null, queries: 1202 });
    expect(figures.slowestQueries.map(({ table, count }) => [table, count])).toEqual([
      ["threads", 2],
      ["tasks", 10],
    ]);
  });

  it("holds no data when no block has a point, a total or a slowest row", () => {
    const empty: Partial<HealthSeries> = {
      responsiveness: { lagP99Ms: [], lagMaxMs: [] },
      requests: { perMinute: [], p95Ms: [], total: 0, totalP95Ms: null, slowest: [] },
    };

    expect(holdsNoHealthData(empty)).toBe(true);
    expect(holdsNoHealthData({})).toBe(true);
    expect(
      holdsNoHealthData({
        ...empty,
        requests: { perMinute: [], p95Ms: [], total: 3, totalP95Ms: 4, slowest: [] },
      }),
    ).toBe(false);
    expect(
      holdsNoHealthData({
        responsiveness: { lagP99Ms: [{ at: span.from, value: 0 }], lagMaxMs: [] },
      }),
    ).toBe(false);
  });
});
