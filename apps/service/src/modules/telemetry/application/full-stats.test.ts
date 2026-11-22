import { beforeEach, describe, expect, it } from "vitest";
import { ManualSchedule } from "../../../platform/schedule/schedule.fixtures.js";
import { ScriptedStatsSource } from "../adapters/scripted/scripted-stats-source.js";
import type { StatsTask } from "../domain/basic-stats.js";
import type {
  StatsInitiative,
  StatsProjectName,
  StatsStageRunEngines,
  StatsStageRunSpan,
  UsageSeries,
} from "../domain/full-stats.js";
import { EngineWindows, type StatsEngine } from "../ports/engine-windows.js";
import { GrafanaInUse, type GrafanaNow } from "../ports/grafana-in-use.js";
import { OfficeInitiatives } from "../ports/office-initiatives.js";
import { OfficeTasks } from "../ports/office-tasks.js";
import { ProjectNames } from "../ports/project-names.js";
import { RunningStageRuns } from "../ports/running-stage-runs.js";
import { StageRunEngines } from "../ports/stage-run-engines.js";
import { FullStats, type FullStatsFigures, type FullStatsRead } from "./full-stats.js";

const NOW = new Date("2026-11-17T10:25:00.000Z");
const ADDRESS = "http://127.0.0.1:3300";
const READY: GrafanaNow = { kind: "ready", access: { address: ADDRESS } };
const QUERY = { range: "24h", split: "model" } as const;

const USAGE: UsageSeries = {
  tokens: [{ name: "opus", points: [{ at: new Date("2026-11-17T09:00:00.000Z"), value: 100 }] }],
  estimatedCostUsd: [
    { name: "opus", points: [{ at: new Date("2026-11-17T09:00:00.000Z"), value: 1.5 }] },
  ],
};

class GrafanaForTests extends GrafanaInUse {
  grafana: GrafanaNow = READY;
  now(): Promise<GrafanaNow> {
    return Promise.resolve(this.grafana);
  }
  savedReadToken(): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }
}

class EnginesForTests extends EngineWindows {
  list(): Promise<readonly StatsEngine[]> {
    return Promise.resolve([
      { engineId: "codex", name: "Codex", windows: { state: "not-read" } },
      { engineId: "api", name: "API", windows: { state: "none" } },
      { engineId: "claude", name: "Claude Code", windows: { state: "not-read" } },
    ]);
  }
}

class RunsForTests extends RunningStageRuns {
  readonly asked: { from: Date; to: Date }[] = [];
  spans: StatsStageRunSpan[] = [];
  between(from: Date, to: Date): Promise<readonly StatsStageRunSpan[]> {
    this.asked.push({ from, to });
    return Promise.resolve(this.spans);
  }
}

class StageRunEnginesForTests extends StageRunEngines {
  readonly asked: (readonly string[])[] = [];
  runs: StatsStageRunEngines[] = [];
  of(taskIds: readonly string[]): Promise<readonly StatsStageRunEngines[]> {
    this.asked.push(taskIds);
    return Promise.resolve(this.runs.filter(({ taskId }) => taskIds.includes(taskId)));
  }
}

class TasksForTests extends OfficeTasks {
  readonly tasks: StatsTask[] = [
    { id: "ours", title: "Show the Stats", projectId: "office" },
    { id: "theirs", title: "Elsewhere", projectId: "other" },
  ];
  doneSince(): Promise<readonly string[]> {
    return Promise.resolve([]);
  }
  findAll(ids: readonly string[]): Promise<readonly StatsTask[]> {
    return Promise.resolve(this.tasks.filter(({ id }) => ids.includes(id)));
  }
}

class InitiativesForTests extends OfficeInitiatives {
  titlesOf(ids: readonly string[]): Promise<readonly StatsInitiative[]> {
    const known = [{ initiativeId: "stats", title: "Stats", projectIds: ["office"] }];
    return Promise.resolve(known.filter(({ initiativeId }) => ids.includes(initiativeId)));
  }
}

class ProjectNamesForTests extends ProjectNames {
  namesOf(ids: readonly string[]): Promise<readonly StatsProjectName[]> {
    const known = [{ projectId: "office", name: "The Office" }];
    return Promise.resolve(known.filter(({ projectId }) => ids.includes(projectId)));
  }
}

function fullOf(read: FullStatsRead): FullStatsFigures {
  if (read.state !== "full") throw new Error(`The full stats are ${read.state}.`);
  return read;
}

let grafana: GrafanaForTests;
let source: ScriptedStatsSource;
let runs: RunsForTests;
let runEngines: StageRunEnginesForTests;
let stats: FullStats;

beforeEach(() => {
  const schedule = new ManualSchedule();
  schedule.setTime(NOW);
  grafana = new GrafanaForTests();
  source = new ScriptedStatsSource();
  runs = new RunsForTests();
  runEngines = new StageRunEnginesForTests();
  stats = new FullStats(
    schedule,
    grafana,
    source,
    new EnginesForTests(),
    runs,
    runEngines,
    new TasksForTests(),
    new InitiativesForTests(),
    new ProjectNamesForTests(),
  );
});

/** One Implement run's spend, on an engine, starting at 09:<minute> on 17 November. */
function aRunSpend(stageRun: string, engineId: string, minute: number, cost: number) {
  return {
    stageName: "Implement",
    stageRun,
    engineId,
    model: "claude-opus-5-5",
    firstAt: new Date(Date.UTC(2026, 10, 17, 9, minute)),
    tokens: cost * 100,
    estimatedCostUsd: cost,
  };
}

describe("FullStats.read", () => {
  it("answers not-on without reading Grafana while none is in use", async () => {
    grafana.grafana = { kind: "none" };

    expect(await stats.read(QUERY, "all")).toEqual({ state: "not-on" });
    expect(source.calls).toEqual([]);
  });

  it("answers starting and failed with the address, reading nothing", async () => {
    grafana.grafana = { kind: "starting", address: ADDRESS };
    expect(await stats.read(QUERY, "all")).toEqual({ state: "starting", address: ADDRESS });

    grafana.grafana = { kind: "failed", address: ADDRESS, problem: "It isn't running." };
    expect(await stats.read(QUERY, "all")).toEqual({
      state: "failed",
      address: ADDRESS,
      problem: "It isn't running.",
    });
    expect(source.calls).toEqual([]);
  });

  it("answers unreachable with the problem though other reads answered", async () => {
    source.set({ usage: USAGE, failure: { kind: "unreachable", problem: "No answer in time." } });

    expect(await stats.read(QUERY, "all")).toEqual({
      state: "unreachable",
      address: ADDRESS,
      problem: "No answer in time.",
    });
  });

  it("answers rejected when Grafana refuses the read token", async () => {
    source.set({ usage: USAGE, failure: { kind: "rejected" } });

    expect(await stats.read(QUERY, "all")).toEqual({ state: "rejected", address: ADDRESS });
  });

  it("answers no-data when Grafana holds nothing The Office sent", async () => {
    expect(await stats.read(QUERY, "all")).toEqual({ state: "no-data", address: ADDRESS });
  });

  it("answers the full stats for the range ending now, each read by its steps", async () => {
    source.set({
      usage: USAGE,
      costliest: {
        tasks: [
          { taskId: "ours", tokens: 100, estimatedCostUsd: 1.5, runs: [] },
          { taskId: "gone", tokens: 900, estimatedCostUsd: 9, runs: [] },
        ],
        initiatives: [
          {
            initiativeId: "stats",
            tokens: 100,
            estimatedCostUsd: 1.5,
            tasks: [
              {
                taskId: "ours",
                stageRun: "",
                engineId: "claude",
                model: "claude-opus-5-5",
                tokens: 100,
                estimatedCostUsd: 1.5,
              },
            ],
          },
        ],
      },
      windows: [
        { engineId: "claude", window: "five_hour", points: [{ at: NOW, value: 41 }] },
        { engineId: "gone", window: "five_hour", points: [{ at: NOW, value: 99 }] },
      ],
    });
    const from = new Date("2026-11-16T10:25:00.000Z");
    runs.spans = [
      {
        engineId: "claude",
        taskId: "ours",
        stageName: "Implement",
        startedAt: NOW,
        endedAt: undefined,
      },
      {
        engineId: "claude",
        taskId: "gone",
        stageName: "Implement",
        startedAt: NOW,
        endedAt: undefined,
      },
    ];

    const read = await stats.read(QUERY, "all");

    expect(source.calls).toEqual([
      {
        kind: "usage",
        access: { address: ADDRESS },
        query: {
          from: new Date("2026-11-16T10:00:00.000Z"),
          // To the end of the step still going on, so the last bucket holds what came since 10:00.
          to: new Date("2026-11-17T11:00:00.000Z"),
          stepSeconds: 3600,
          split: "model",
          projectNames: undefined,
        },
      },
      {
        kind: "costliest",
        access: { address: ADDRESS },
        query: { from, to: NOW, limit: 10, projectNames: undefined },
      },
      {
        kind: "windows",
        access: { address: ADDRESS },
        query: {
          from: new Date("2026-11-16T10:15:00.000Z"),
          to: new Date("2026-11-17T10:30:00.000Z"),
          stepSeconds: 900,
        },
      },
    ]);
    expect(runs.asked).toEqual([{ from, to: NOW }]);
    expect(read).toMatchObject({
      state: "full",
      address: ADDRESS,
      range: "24h",
      split: "model",
      from,
      to: NOW,
      costliestTasks: [{ taskId: "ours", title: "Show the Stats", projectId: "office" }],
      costliestInitiatives: [
        {
          initiativeId: "stats",
          title: "Stats",
          tasks: [{ taskId: "ours", title: "Show the Stats" }],
        },
      ],
      windows: [
        { engineId: "codex", name: "Codex", fiveHour: [], sevenDay: [] },
        {
          engineId: "claude",
          name: "Claude Code",
          fiveHour: [{ at: NOW, percentUsed: 41 }],
          sevenDay: [],
        },
      ],
      running: [{ taskId: "ours", title: "Show the Stats", projectId: "office" }],
    });
    expect(fullOf(read).usage).toHaveLength(25);
    expect(fullOf(read).usage.find(({ groups }) => groups.length > 0)).toEqual({
      at: new Date("2026-11-17T09:00:00.000Z"),
      groups: [{ name: "opus", tokens: 100, estimatedCostUsd: 1.5 }],
    });
    expect(fullOf(read).running).toHaveLength(1);
  });

  it("names what each try ran on from its Stage run's engines, then the engines now, asking only for the most expensive Tasks", async () => {
    source.set({
      usage: USAGE,
      costliest: {
        tasks: [
          {
            taskId: "ours",
            tokens: 300,
            estimatedCostUsd: 3,
            runs: [aRunSpend("1", "claude", 0, 2), aRunSpend("2", "codex", 10, 1)],
          },
        ],
        initiatives: [],
      },
    });
    runs.spans = [
      {
        engineId: "claude",
        taskId: "theirs",
        stageName: "Review",
        startedAt: NOW,
        endedAt: undefined,
      },
    ];
    runEngines.runs = [
      {
        taskId: "ours",
        number: 2,
        engineId: "codex",
        engineName: "Codex then",
        standInFor: { engineId: "claude", engineName: "Claude Code" },
        switches: [],
      },
    ];

    const [task] = fullOf(await stats.read(QUERY, "all")).costliestTasks;

    expect(runEngines.asked).toEqual([["ours"]]);
    expect(task?.stages[0]?.tries.map(({ ranOn }) => ranOn)).toEqual([
      [
        {
          engineName: "Claude Code",
          model: "claude-opus-5-5",
          standInForEngineName: undefined,
          tokens: 200,
          estimatedCostUsd: 2,
        },
      ],
      [
        {
          engineName: "Codex then",
          model: "claude-opus-5-5",
          standInForEngineName: "Claude Code",
          tokens: 100,
          estimatedCostUsd: 1,
        },
      ],
    ]);
  });

  it("narrows usage and the most expensive by the Projects' names and the lane by each Task's Project, the windows staying Office-wide", async () => {
    source.set({
      usage: USAGE,
      windows: [{ engineId: "claude", window: "seven_day", points: [{ at: NOW, value: 7 }] }],
    });
    runs.spans = [
      {
        engineId: "claude",
        taskId: "ours",
        stageName: "Implement",
        startedAt: NOW,
        endedAt: undefined,
      },
      {
        engineId: "claude",
        taskId: "theirs",
        stageName: "Review",
        startedAt: NOW,
        endedAt: undefined,
      },
    ];

    const read = await stats.read(QUERY, ["office", "unknown"]);

    expect(
      source.calls.flatMap((call) =>
        call.kind === "usage" || call.kind === "costliest" ? [call.query.projectNames] : [],
      ),
    ).toEqual([["The Office"], ["The Office"]]);
    expect(read).toMatchObject({
      state: "full",
      windows: [
        { engineId: "codex" },
        { engineId: "claude", sevenDay: [{ at: NOW, percentUsed: 7 }] },
      ],
      running: [{ taskId: "ours" }],
    });
    expect(fullOf(read).running).toHaveLength(1);
  });

  it("reads no usage nor most expensive when none of the filter's Projects is known", async () => {
    source.set({
      usage: USAGE,
      windows: [{ engineId: "claude", window: "seven_day", points: [{ at: NOW, value: 7 }] }],
    });

    const read = await stats.read(QUERY, ["unknown"]);

    expect(source.calls.map(({ kind }) => kind)).toEqual(["windows"]);
    expect(read).toMatchObject({ state: "full", costliestTasks: [], costliestInitiatives: [] });
    expect(fullOf(read).usage.every(({ groups }) => groups.length === 0)).toBe(true);
  });
});
