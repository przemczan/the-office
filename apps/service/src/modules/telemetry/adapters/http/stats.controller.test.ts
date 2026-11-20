import { Injectable, Module, type INestApplication } from "@nestjs/common";
import {
  BASIC_STATS_DAYS,
  basicStatsSchema,
  fullStatsReadSchema,
  fullStatsSchema,
  grafanaCheckAnswerSchema,
  systemHealthReadSchema,
  systemHealthSchema,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { Schedule } from "../../../../platform/schedule/schedule.js";
import type { ManualSchedule } from "../../../../platform/schedule/schedule.fixtures.js";
import { TelemetryHttpModule } from "../../../../platform/telemetry/telemetry-http.module.js";
import type { StatsStageRun, StatsTask } from "../../domain/basic-stats.js";
import type {
  StatsInitiative,
  StatsProjectName,
  StatsStageRunSpan,
} from "../../domain/full-stats.js";
import type { HealthHour } from "../../domain/system-health.js";
import type { StatsDay } from "../../ports/day-tokens.js";
import type { StatsEngine } from "../../ports/engine-windows.js";
import { GrafanaInUse, type GrafanaNow } from "../../ports/grafana-in-use.js";
import { StatsSource } from "../../ports/stats-source.js";
import { StatsModule } from "../../stats.module.js";
import { ScriptedStatsSource } from "../scripted/scripted-stats-source.js";

const TOKENS = { input: 1, output: 2, cacheRead: 3, cacheCreation: 4 };

@Injectable()
class DaysForTests {
  readonly asked: { count: number; now: Date }[] = [];

  async lastDays(count: number, now: Date): Promise<readonly StatsDay[]> {
    this.asked.push({ count, now });
    return Array.from({ length: count }, (_, index) => ({
      day: `2026-10-${String(index + 1).padStart(2, "0")}`,
      tokens: index === count - 1 ? TOKENS : { ...TOKENS, input: -5 },
    }));
  }
}

@Injectable()
class EnginesForTests {
  async list(): Promise<readonly StatsEngine[]> {
    return [
      {
        engineId: "claude-code",
        name: "Claude Code",
        windows: {
          state: "read",
          fiveHour: { percentUsed: 41, resetsAt: new Date("2026-11-17T14:00:00.000Z") },
          sevenDay: { percentUsed: 12, resetsAt: undefined },
          readAt: new Date("2026-11-17T09:00:00.000Z"),
        },
      },
      { engineId: "strata", name: "Strata", windows: { state: "none" } },
    ];
  }
}

const OURS = "4b0d4c3e-8f1a-4f6e-9a39-1c2d3e4f5a6b";
const THEIRS = "7e2a9b1c-3d4e-4f5a-8b6c-7d8e9f0a1b2c";

@Injectable()
class RunsForTests {
  readonly asked: Date[] = [];

  async since(since: Date): Promise<readonly StatsStageRun[]> {
    this.asked.push(since);
    return [
      { taskId: OURS, tokens: TOKENS, retry: false },
      { taskId: OURS, tokens: TOKENS, retry: true },
      { taskId: THEIRS, tokens: TOKENS, retry: true },
    ];
  }
}

@Injectable()
class TasksForTests {
  async doneSince(): Promise<readonly string[]> {
    return [OURS, THEIRS];
  }

  async findAll(ids: readonly string[]): Promise<readonly StatsTask[]> {
    const tasks = [
      { id: OURS, title: "Show the Stats", projectId: "office" },
      { id: THEIRS, title: "Elsewhere", projectId: "other" },
    ];
    return tasks.filter(({ id }) => ids.includes(id));
  }
}

@Injectable()
class SpansForTests {
  async between(from: Date): Promise<readonly StatsStageRunSpan[]> {
    return [
      {
        engineId: "claude-code",
        taskId: OURS,
        stageName: "Implement",
        startedAt: from,
        endedAt: undefined,
      },
      {
        engineId: "claude-code",
        taskId: THEIRS,
        stageName: "Review",
        startedAt: from,
        endedAt: from,
      },
    ];
  }
}

@Injectable()
class InitiativesForTests {
  async titlesOf(): Promise<readonly StatsInitiative[]> {
    return [];
  }
}

@Injectable()
class ProjectNamesForTests {
  async namesOf(ids: readonly string[]): Promise<readonly StatsProjectName[]> {
    return ids.includes("office") ? [{ projectId: "office", name: "The Office" }] : [];
  }
}

const CALLED_FROM =
  "apps/service/src/modules/work/adapters/drizzle-task-repository.ts:142 (DrizzleTaskRepository.findById)";

const HOUR: HealthHour = {
  readingsSince: new Date("2026-11-17T09:12:00.000Z"),
  readings: [
    {
      at: new Date("2026-11-17T10:24:55.000Z"),
      eventLoopLagP99Ms: 9.1,
      eventLoopLagMaxMs: 842,
      officeCpuPercent: 23,
      officeCpuOfWorkstationPercent: 2.875,
      memoryInUseBytes: 300_000_000,
      heapUsedBytes: 120_000_000,
      workstationCpuPercent: null,
      workstationMemoryPercent: 61,
      requests: 2,
      requestP95Ms: 46,
      queries: 1,
      queryP95Ms: 9.8,
      connectionsWaiting: 1,
    },
  ],
  requests: 2,
  requestP95Ms: 46,
  queries: 1,
  queryP95Ms: 9.8,
  slowestRoutes: [
    {
      route: { method: "GET", template: "/api/tasks/:id" },
      count: 2,
      p95Ms: 46,
      maxMs: 50,
      totalMs: 90,
    },
  ],
  slowestQueries: [
    {
      operation: "SELECT",
      table: "tasks",
      shape: "SELECT * FROM tasks WHERE id = ?",
      calledFrom: [CALLED_FROM],
      count: 1,
      p95Ms: 9.8,
      maxMs: 9.8,
      totalMs: 9.8,
    },
  ],
};

@Injectable()
class HealthReadingsForTests {
  lastHour(): HealthHour {
    return HOUR;
  }
}

@Injectable()
class SessionsForTests {
  async sessionsWorking(): Promise<number> {
    return 3;
  }
}

@Injectable()
class StageRunsRunningForTests {
  count(): number {
    return 2;
  }
}

@Injectable()
class ConnectionsForTests {
  openConnections(): number {
    return 4;
  }
}

const SOURCES = [
  HealthReadingsForTests,
  SessionsForTests,
  StageRunsRunningForTests,
  ConnectionsForTests,
  DaysForTests,
  EnginesForTests,
  RunsForTests,
  TasksForTests,
  SpansForTests,
  InitiativesForTests,
  ProjectNamesForTests,
];

@Module({ providers: SOURCES, exports: SOURCES })
class StatsSourcesForTests {}

/** Settings › Telemetry's module, which the full stats' Grafana in use reads, left out here. */
@Module({})
class NoTelemetrySettings {}

const READY: GrafanaNow = { kind: "ready", access: { address: "http://127.0.0.1:3300" } };
let grafanaInUse: GrafanaNow = READY;
const grafanaNow: {
  now: () => Promise<GrafanaNow>;
  savedReadToken: () => Promise<string | undefined>;
} = {
  now: () => Promise.resolve(grafanaInUse),
  savedReadToken: () => Promise.resolve("saved-token"),
};
const statsSource = new ScriptedStatsSource();

let app: INestApplication;
let url: string;

beforeAll(async () => {
  ({ app, url } = await startTestApplication({
    imports: [
      StatsModule.register({
        imports: [StatsSourcesForTests],
        dayTokens: DaysForTests,
        engineWindows: EnginesForTests,
        stageRunTotals: RunsForTests,
        runningStageRuns: SpansForTests,
        officeTasks: TasksForTests,
        officeInitiatives: InitiativesForTests,
        projectNames: ProjectNamesForTests,
        healthReadings: HealthReadingsForTests,
        sessionsRunning: SessionsForTests,
        stageRunsRunning: StageRunsRunningForTests,
        browserConnections: ConnectionsForTests,
        statsSource: ScriptedStatsSource,
      }),
    ],
    moduleOverrides: [{ module: TelemetryHttpModule, useModule: NoTelemetrySettings }],
    overrides: [
      { provide: GrafanaInUse, useValue: grafanaNow },
      { provide: StatsSource, useValue: statsSource },
    ],
  }));
});

afterAll(async () => {
  await app.close();
});

describe("GET /stats/basic", () => {
  it("answers the basic stats, the Project filter narrowing only what belongs to a Task", async () => {
    // Wednesday 18 November 2026, so this week began on Monday the 16th.
    const now = new Date(2026, 10, 18, 15, 30);
    (app.get(Schedule) as ManualSchedule).setTime(now);
    const weekStart = new Date(2026, 10, 16);

    const response = await fetch(`${url}/api/stats/basic?project=office`);
    const stats = basicStatsSchema.parse(await response.json());

    expect(response.status).toBe(200);
    expect(app.get(DaysForTests).asked).toEqual([{ count: BASIC_STATS_DAYS, now }]);
    expect(app.get(RunsForTests).asked).toEqual([weekStart]);
    expect(stats.days).toHaveLength(BASIC_STATS_DAYS);
    expect(stats.days.at(-1)?.tokens).toEqual(TOKENS);
    expect(stats.days[0]?.tokens).toEqual({ ...TOKENS, input: 0 });
    expect(stats).toMatchObject({
      weekStartsAt: weekStart.toISOString(),
      topTasks: [{ taskId: OURS, title: "Show the Stats", projectId: "office", tokens: 14 }],
      tasksDone: 1,
      stageRetries: 1,
      engines: [
        {
          engineId: "claude-code",
          name: "Claude Code",
          windows: {
            state: "read",
            fiveHour: { percentUsed: 41, resetsAt: "2026-11-17T14:00:00.000Z" },
            sevenDay: { percentUsed: 12, resetsAt: null },
            readAt: "2026-11-17T09:00:00.000Z",
          },
        },
        { engineId: "strata", name: "Strata", windows: { state: "none" } },
      ],
    });
  });
});

describe("GET /stats/full", () => {
  it("answers the full stats from Grafana, the Project filter narrowing by the Projects' names", async () => {
    const now = new Date("2026-11-17T10:25:00.000Z");
    (app.get(Schedule) as ManualSchedule).setTime(now);
    statsSource.set({
      usage: {
        tokens: [
          { name: "opus", points: [{ at: new Date("2026-11-17T09:00:00.000Z"), value: 10 }] },
        ],
        estimatedCostUsd: [],
      },
      costliest: {
        tasks: [
          {
            taskId: OURS,
            tokens: 10,
            estimatedCostUsd: 0.5,
            runs: [
              {
                stageName: "Implement",
                stageRun: "run-1",
                firstAt: new Date("2026-11-17T09:00:00.000Z"),
                tokens: 10,
                estimatedCostUsd: 0.5,
              },
            ],
          },
        ],
        initiatives: [],
      },
    });

    const response = await fetch(`${url}/api/stats/full?range=24h&split=project&project=office`);
    const stats = fullStatsSchema.parse(await response.json());

    expect(response.status).toBe(200);
    const usage = statsSource.calls.find((call) => call.kind === "usage");
    expect(usage?.kind === "usage" && usage.query).toMatchObject({
      split: "project",
      projectNames: ["The Office"],
    });
    expect(stats).toMatchObject({
      state: "full",
      address: "http://127.0.0.1:3300",
      range: "24h",
      split: "project",
      from: "2026-11-16T10:25:00.000Z",
      to: now.toISOString(),
      costliestTasks: [
        {
          taskId: OURS,
          title: "Show the Stats",
          projectId: "office",
          stages: [{ stageName: "Implement", tries: [{ try: 1, estimatedCostUsd: 0.5 }] }],
          outsideStages: { tokens: 0, estimatedCostUsd: 0 },
        },
      ],
      windows: [{ engineId: "claude-code", name: "Claude Code", fiveHour: [], sevenDay: [] }],
      running: [{ taskId: OURS, title: "Show the Stats", stageName: "Implement" }],
    });
    const full = fullStatsReadSchema.parse(stats);
    expect(full.usage).toHaveLength(25);
    expect(full.running).toHaveLength(1);
    expect(full.running[0]).not.toHaveProperty("endedAt");
  });

  it("refuses a range it doesn't know", async () => {
    const response = await fetch(`${url}/api/stats/full?range=1y`);

    expect(response.status).toBe(400);
  });
});

async function readHealth(query: string) {
  const response = await fetch(`${url}/api/stats/system-health${query}`);
  return { status: response.status, health: systemHealthSchema.parse(await response.json()) };
}

describe("GET /stats/system-health", () => {
  const LOAD_NOW = { sessionsRunning: 3, stageRunsRunning: 2, browserConnectionsOpen: 4 };
  const ADDRESS = "http://127.0.0.1:3300";

  afterEach(() => {
    grafanaInUse = READY;
  });

  it("reads 1 h, the default, from the Health readings with telemetry not on", async () => {
    const now = new Date("2026-11-17T10:25:00.000Z");
    (app.get(Schedule) as ManualSchedule).setTime(now);
    grafanaInUse = { kind: "none" };
    const callsBefore = statsSource.calls.length;

    const { status, health } = await readHealth("");

    expect(status).toBe(200);
    expect(statsSource.calls).toHaveLength(callsBefore);
    expect(health).toMatchObject({ range: "1h", loadNow: LOAD_NOW });
    expect(systemHealthReadSchema.parse(health.readings)).toEqual({
      state: "read",
      from: "2026-11-17T09:25:00.000Z",
      to: now.toISOString(),
      stepSeconds: 5,
      readingsSince: "2026-11-17T09:12:00.000Z",
      points: [
        {
          at: "2026-11-17T10:24:55.000Z",
          eventLoopLagP99Ms: 9.1,
          eventLoopLagMaxMs: 842,
          officeCpuPercent: 23,
          officeCpuOfWorkstationPercent: 2.875,
          memoryInUseBytes: 300_000_000,
          heapUsedBytes: 120_000_000,
          workstationCpuPercent: null,
          workstationMemoryPercent: 61,
          requestsPerMinute: 24,
          requestP95Ms: 46,
          queriesPerMinute: 12,
          queryP95Ms: 9.8,
          connectionsWaiting: 1,
        },
      ],
      requests: 2,
      requestP95Ms: 46,
      queries: 1,
      queryP95Ms: 9.8,
      slowestRoutes: [
        {
          route: { method: "GET", template: "/api/tasks/:id" },
          count: 2,
          p95Ms: 46,
          maxMs: 50,
          totalMs: 90,
        },
      ],
      slowestQueries: [
        {
          operation: "SELECT",
          table: "tasks",
          shape: "SELECT * FROM tasks WHERE id = ?",
          calledFrom: [CALLED_FROM],
          count: 1,
          p95Ms: 9.8,
          maxMs: 9.8,
          totalMs: 9.8,
        },
      ],
      unansweredBlocks: [],
    });
  });

  it.each([
    ["24h", 300],
    ["7d", 3600],
    ["30d", 21600],
  ] as const)("reads %s from Grafana by its step of %i s", async (range, stepSeconds) => {
    (app.get(Schedule) as ManualSchedule).setTime(new Date("2026-11-17T10:25:00.000Z"));
    statsSource.set({
      systemHealth: {
        requests: {
          perMinute: [{ at: new Date("2026-11-17T00:00:00.000Z"), value: 30.2 }],
          p95Ms: [{ at: new Date("2026-11-17T00:00:00.000Z"), value: 46 }],
          total: 18_400.4,
          totalP95Ms: 46,
          slowest: [
            { route: null, count: 3, p95Ms: 5, maxMs: 10, totalMs: 9 },
            {
              route: { method: "GET", template: "/api/tasks/:id/stage-runs" },
              count: 18_397,
              p95Ms: 46,
              maxMs: 250,
              totalMs: 251_000,
            },
          ],
        },
        database: {
          perMinute: [],
          p95Ms: [],
          connectionsWaiting: [],
          total: 0,
          totalP95Ms: null,
          slowest: [
            { operation: "SELECT", table: "stage_runs", count: 4, p95Ms: 2, maxMs: 5, totalMs: 8 },
          ],
        },
      },
    });

    const { health } = await readHealth(`?range=${range}`);

    const call = statsSource.calls.findLast((one) => one.kind === "system-health");
    expect(call?.query.stepSeconds).toBe(stepSeconds);
    expect(health).toMatchObject({ range, loadNow: LOAD_NOW });
    const read = systemHealthReadSchema.parse(health.readings);
    expect(read).toMatchObject({
      stepSeconds,
      requests: 18_400,
      requestP95Ms: 46,
      queries: 0,
      queryP95Ms: null,
      unansweredBlocks: [],
      address: ADDRESS,
    });
    expect(read).not.toHaveProperty("readingsSince");
    expect(read.points).toHaveLength(1);
    expect(read.points[0]).toMatchObject({ requestsPerMinute: 30.2, eventLoopLagP99Ms: null });
    expect(read.slowestRoutes.map(({ route }) => route?.template ?? null)).toEqual([
      "/api/tasks/:id/stage-runs",
      null,
    ]);
    expect(read.slowestQueries).toEqual([
      { operation: "SELECT", table: "stage_runs", count: 4, p95Ms: 2, maxMs: 5, totalMs: 8 },
    ]);
  });

  it.each([
    [{ kind: "none" }, {}, { state: "not-on" }],
    [{ kind: "starting", address: ADDRESS }, {}, { state: "starting", address: ADDRESS }],
    [
      READY,
      { failure: { kind: "unreachable", problem: "No answer within 10 seconds." } },
      { state: "unreachable", address: ADDRESS, problem: "No answer within 10 seconds." },
    ],
    [READY, { failure: { kind: "rejected" } }, { state: "rejected", address: ADDRESS }],
    [READY, {}, { state: "no-data", address: ADDRESS }],
  ] as const)(
    "gives a longer range the Grafana's state, with Load now: %j %j",
    async (now, stats, readings) => {
      grafanaInUse = now;
      statsSource.set(stats);

      const { health } = await readHealth("?range=7d");

      expect(health).toEqual({ range: "7d", loadNow: LOAD_NOW, readings });
    },
  );

  it("shows the blocks that answered, naming those whose query failed", async () => {
    statsSource.set({
      systemHealth: {
        responsiveness: {
          lagP99Ms: [{ at: new Date("2026-11-17T09:00:00.000Z"), value: 9 }],
          lagMaxMs: [],
        },
      },
      systemHealthFailures: { database: { kind: "unreachable", problem: "Query data error" } },
    });

    const { health } = await readHealth("?range=24h");

    expect(health.readings).toMatchObject({
      state: "read",
      unansweredBlocks: ["database"],
      address: ADDRESS,
    });
  });

  it("refuses a range it doesn't know", async () => {
    const response = await fetch(`${url}/api/stats/system-health?range=1y`);

    expect(response.status).toBe(400);
  });
});

async function check(body: unknown): Promise<{ status: number; answer: unknown }> {
  const response = await fetch(`${url}/api/stats/grafana-check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, answer: await response.json() };
}

function lastAccess(): unknown {
  return statsSource.calls.findLast((call) => call.kind === "data-sources")?.access;
}

describe("POST /stats/grafana-check", () => {
  it("checks the address with the read token given, trimmed", async () => {
    statsSource.set({});

    const { status, answer } = await check({
      readAddress: " https://grafana.example.com ",
      readToken: " glsa_new ",
    });

    expect(status).toBe(200);
    expect(grafanaCheckAnswerSchema.parse(answer)).toEqual({
      state: "reachable",
      prometheus: "Prometheus",
      loki: "Loki",
    });
    expect(lastAccess()).toEqual({ address: "https://grafana.example.com", token: "glsa_new" });
  });

  it("checks with the saved read token when none is given", async () => {
    statsSource.set({});

    await check({ readAddress: "https://grafana.example.com", readToken: "" });

    expect(lastAccess()).toEqual({ address: "https://grafana.example.com", token: "saved-token" });
  });

  it.each([
    [{ failure: { kind: "rejected" } }, { state: "rejected" }],
    [
      { failure: { kind: "unreachable", problem: "No answer within 10 seconds." } },
      { state: "unreachable", problem: "No answer within 10 seconds." },
    ],
    [
      { dataSources: { prometheus: "Prometheus" } },
      { state: "no-data-sources", missing: ["loki"] },
    ],
  ] as const)("answers what the Grafana came to: %j", async (stats, expected) => {
    statsSource.set(stats);

    const { answer } = await check({ readAddress: "https://grafana.example.com" });

    expect(answer).toEqual(expected);
  });

  it("answers unreachable, asking nothing, for an address that isn't http or https", async () => {
    statsSource.set({});
    const callsBefore = statsSource.calls.length;

    const { answer } = await check({ readAddress: "ftp://grafana.example.com" });

    expect(answer).toEqual({
      state: "unreachable",
      problem: "ftp://grafana.example.com isn't an http:// or https:// address.",
    });
    expect(statsSource.calls).toHaveLength(callsBefore);
  });

  it("refuses a body without a read address", async () => {
    const { status } = await check({ readToken: "glsa" });

    expect(status).toBe(400);
  });
});
