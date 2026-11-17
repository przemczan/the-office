import { Injectable, Module, type INestApplication } from "@nestjs/common";
import { BASIC_STATS_DAYS, basicStatsSchema } from "@the-office/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { Schedule } from "../../../../platform/schedule/schedule.js";
import type { ManualSchedule } from "../../../../platform/schedule/schedule.fixtures.js";
import type { StatsStageRun, StatsTask } from "../../domain/basic-stats.js";
import type { StatsDay } from "../../ports/day-tokens.js";
import type { StatsEngine } from "../../ports/engine-windows.js";
import { StatsModule } from "../../stats.module.js";

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

@Module({
  providers: [DaysForTests, EnginesForTests, RunsForTests, TasksForTests],
  exports: [DaysForTests, EnginesForTests, RunsForTests, TasksForTests],
})
class StatsSourcesForTests {}

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
        officeTasks: TasksForTests,
      }),
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
