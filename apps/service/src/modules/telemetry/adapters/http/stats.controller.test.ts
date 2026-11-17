import { Injectable, Module, type INestApplication } from "@nestjs/common";
import {
  BASIC_STATS_DAYS,
  basicStatsSchema,
  fullStatsReadSchema,
  fullStatsSchema,
} from "@the-office/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

const SOURCES = [
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

const grafanaNow: { now: () => Promise<GrafanaNow> } = {
  now: () => Promise.resolve({ kind: "ready", access: { address: "http://127.0.0.1:3300" } }),
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
    expect(statsSource.calls.find(({ kind }) => kind === "usage")?.query).toMatchObject({
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
