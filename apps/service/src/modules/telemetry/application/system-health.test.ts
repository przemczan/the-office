import { beforeEach, describe, expect, it } from "vitest";
import { ManualSchedule } from "../../../platform/schedule/schedule.fixtures.js";
import { ScriptedStatsSource } from "../adapters/scripted/scripted-stats-source.js";
import type { HealthHour, HealthSeries } from "../domain/system-health.js";
import { BrowserConnections } from "../ports/browser-connections.js";
import { GrafanaInUse, type GrafanaNow } from "../ports/grafana-in-use.js";
import { HealthReadings } from "../ports/health-readings.js";
import { SessionsRunning } from "../ports/sessions-running.js";
import { StageRunsRunning } from "../ports/stage-runs-running.js";
import { SystemHealth, type HealthReadingsRead, type SystemHealthRead } from "./system-health.js";

const NOW = new Date("2026-11-17T10:25:00.000Z");
const ADDRESS = "http://127.0.0.1:3300";
const READY: GrafanaNow = { kind: "ready", access: { address: ADDRESS } };

const HOUR: HealthHour = {
  readingsSince: new Date("2026-11-17T10:20:00.000Z"),
  readings: [
    {
      at: new Date("2026-11-17T10:24:55.000Z"),
      eventLoopLagP99Ms: 9.1,
      eventLoopLagMaxMs: 12,
      officeCpuPercent: 23,
      officeCpuOfWorkstationPercent: 2.875,
      memoryInUseBytes: 300_000_000,
      heapUsedBytes: 120_000_000,
      workstationCpuPercent: 40,
      workstationMemoryPercent: 61,
      requests: 2,
      requestP95Ms: 46,
      queries: 0,
      queryP95Ms: null,
      connectionsWaiting: 0,
    },
  ],
  requests: 2,
  requestP95Ms: 46,
  queries: 0,
  queryP95Ms: null,
  slowestRoutes: [],
  slowestQueries: [],
};

const LAG: Partial<HealthSeries> = {
  responsiveness: {
    lagP99Ms: [{ at: new Date("2026-11-17T10:00:00.000Z"), value: 8 }],
    lagMaxMs: [{ at: new Date("2026-11-17T10:00:00.000Z"), value: 40 }],
  },
};

class GrafanaForTests extends GrafanaInUse {
  grafana: GrafanaNow = READY;
  now(): Promise<GrafanaNow> {
    return Promise.resolve(this.grafana);
  }
  savedReadToken(): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }
  savedReadAddress(): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }
}

class ReadingsForTests extends HealthReadings {
  lastHour(): HealthHour {
    return HOUR;
  }
}

class SessionsForTests extends SessionsRunning {
  sessionsWorking(): Promise<number> {
    return Promise.resolve(3);
  }
}

class StageRunsForTests extends StageRunsRunning {
  count(): number {
    return 2;
  }
}

class ConnectionsForTests extends BrowserConnections {
  openConnections(): number {
    return 5;
  }
}

function readOf(health: SystemHealthRead): HealthReadingsRead {
  if (health.readings.state !== "read") throw new Error(`Read ${health.readings.state}.`);
  return health.readings;
}

let grafana: GrafanaForTests;
let source: ScriptedStatsSource;
let health: SystemHealth;

beforeEach(() => {
  const schedule = new ManualSchedule();
  schedule.setTime(NOW);
  grafana = new GrafanaForTests();
  source = new ScriptedStatsSource();
  health = new SystemHealth(
    schedule,
    grafana,
    source,
    new ReadingsForTests(),
    new SessionsForTests(),
    new StageRunsForTests(),
    new ConnectionsForTests(),
  );
});

const LOAD_NOW = { sessionsRunning: 3, stageRunsRunning: 2, browserConnectionsOpen: 5 };

describe("System health", () => {
  it("reads the last hour from the Health readings with telemetry off, asking no Grafana", async () => {
    grafana.grafana = { kind: "none" };

    const read = await health.read("1h");

    expect(read.loadNow).toEqual(LOAD_NOW);
    expect(readOf(read)).toMatchObject({
      state: "read",
      from: new Date("2026-11-17T09:25:00.000Z"),
      to: NOW,
      stepSeconds: 5,
      readingsSince: HOUR.readingsSince,
      requests: 2,
      unansweredBlocks: [],
    });
    expect(readOf(read).points[0]).toMatchObject({ requestsPerMinute: 24, queriesPerMinute: 0 });
    expect(readOf(read)).not.toHaveProperty("address");
    expect(source.calls).toEqual([]);
  });

  it("reads the last hour without asking a Grafana that is ready but failing", async () => {
    source.set({ failure: { kind: "unreachable", problem: "Nothing answers." } });

    const read = await health.read("1h");

    expect(readOf(read)).toMatchObject({ state: "read", requests: 2, unansweredBlocks: [] });
    expect(source.calls).toEqual([]);
  });

  it.each([
    [{ kind: "none" }, { state: "not-on" }],
    [
      { kind: "starting", address: ADDRESS },
      { state: "starting", address: ADDRESS },
    ],
    [
      { kind: "failed", address: ADDRESS, problem: "No Docker." },
      { state: "failed", address: ADDRESS, problem: "No Docker." },
    ],
  ] as const)(
    "gives a longer range the full stats' state, with Load now: %j",
    async (now, expected) => {
      grafana.grafana = now;

      const read = await health.read("7d");

      expect(read).toEqual({ range: "7d", loadNow: LOAD_NOW, readings: expected });
    },
  );

  it("reads a longer range from Grafana by its step, aligned to the epoch in UTC", async () => {
    source.set({ systemHealth: LAG });

    const read = await health.read("24h");

    expect(source.calls).toEqual([
      {
        kind: "system-health",
        access: { address: ADDRESS },
        query: {
          from: new Date("2026-11-16T10:25:00.000Z"),
          to: new Date("2026-11-17T10:30:00.000Z"),
          stepSeconds: 300,
        },
      },
    ]);
    expect(readOf(read)).toMatchObject({
      state: "read",
      from: new Date("2026-11-16T10:25:00.000Z"),
      to: NOW,
      stepSeconds: 300,
      unansweredBlocks: [],
      address: ADDRESS,
    });
    expect(readOf(read).points).toEqual([
      expect.objectContaining({
        at: new Date("2026-11-17T10:05:00.000Z"),
        eventLoopLagP99Ms: 8,
        eventLoopLagMaxMs: 40,
      }),
    ]);
  });

  it("answers no data when Grafana holds nothing The Office sent", async () => {
    const read = await health.read("30d");

    expect(read.readings).toEqual({ state: "no-data", address: ADDRESS });
  });

  it("shows the blocks that answered and names those that didn't", async () => {
    source.set({
      systemHealth: LAG,
      systemHealthFailures: {
        requests: { kind: "unreachable", problem: "No answer within 10 seconds." },
        database: { kind: "rejected" },
      },
    });

    const read = await health.read("7d");

    expect(readOf(read).unansweredBlocks).toEqual(["requests", "database"]);
    expect(readOf(read).points[0]).toMatchObject({ eventLoopLagP99Ms: 8, requestsPerMinute: null });
  });

  it("gives the first failing block's state when nothing answered, or nothing that answered held data", async () => {
    source.set({ failure: { kind: "rejected" } });
    expect((await health.read("7d")).readings).toEqual({ state: "rejected", address: ADDRESS });

    source.set({
      systemHealthFailures: {
        "cpu-and-memory": { kind: "unreachable", problem: "Nothing answers." },
      },
    });
    expect((await health.read("7d")).readings).toEqual({
      state: "unreachable",
      address: ADDRESS,
      problem: "Nothing answers.",
    });
  });
});
