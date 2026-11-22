import { describe, expect, it } from "vitest";
import type { StatsTask } from "./basic-stats.js";
import {
  COSTLIEST,
  costliestOf,
  fullStatsSpanOf,
  holdsNoData,
  runningOf,
  stepEndOf,
  stepsOf,
  usageBucketsOf,
  windowsOverTimeOf,
  type StageRunSpend,
  type StatsStageRunEngines,
  type StatsStageRunSpan,
  type TaskSpend,
} from "./full-stats.js";

const HOUR_MS = 3_600_000;
const NOW = new Date("2026-11-17T10:25:00.000Z");

function aTask(id: string, projectId = "office"): StatsTask {
  return { id, title: `Task ${id}`, projectId };
}

function aTaskSpend(
  taskId: string,
  estimatedCostUsd: number,
  runs: StageRunSpend[] = [],
): TaskSpend {
  return { taskId, tokens: estimatedCostUsd * 1000, estimatedCostUsd, runs };
}

function aRun(
  stageName: string,
  stageRun: string,
  minute: number,
  cost: number,
  { engineId = "work", model = "claude-opus-5-5" } = {},
): StageRunSpend {
  return {
    stageName,
    stageRun,
    engineId,
    model,
    firstAt: new Date(Date.UTC(2026, 10, 17, 9, minute)),
    tokens: Math.round(cost * 100),
    estimatedCostUsd: cost,
  };
}

function aRunOnEngines(
  taskId: string,
  number: number,
  engineId: string,
  engineName: string,
  more: Partial<Pick<StatsStageRunEngines, "standInFor" | "switches">> = {},
): StatsStageRunEngines {
  return { taskId, number, engineId, engineName, standInFor: undefined, switches: [], ...more };
}

/** No Stage run kept an engine, and no engine is known now. */
const NO_ENGINES = { stageRunEngines: [], engines: [] };

/** Run 1 of t1 ran on Personal, standing in for Work, after its session moved there from Work. */
const SWITCHED_RUN = aRunOnEngines("t1", 1, "personal", "Personal", {
  standInFor: { engineId: "work", engineName: "Work" },
  switches: [
    {
      fromEngineId: "work",
      fromEngineName: "Work",
      toEngineId: "personal",
      toEngineName: "Personal",
    },
  ],
});

/** An Initiative's spend on one Task's Stage run, on an engine, with Opus 5.5. */
function anInitiativePart(taskId: string, stageRun: string, engineId: string, cost: number) {
  return {
    taskId,
    stageRun,
    engineId,
    model: "claude-opus-5-5",
    tokens: Math.round(cost * 100),
    estimatedCostUsd: cost,
  };
}

/** What a piece of spend on Work with Opus 5.5 ran on. */
function onWork(cost: number) {
  return {
    engineName: "Work",
    model: "claude-opus-5-5",
    standInForEngineName: undefined,
    tokens: Math.round(cost * 100),
    estimatedCostUsd: cost,
  };
}

describe("fullStatsSpanOf", () => {
  it.each([
    ["24h", 24 * HOUR_MS, HOUR_MS, HOUR_MS / 4],
    ["7d", 7 * 24 * HOUR_MS, 6 * HOUR_MS, HOUR_MS],
    ["30d", 30 * 24 * HOUR_MS, 24 * HOUR_MS, 6 * HOUR_MS],
  ] as const)("ends %s at now and goes by its fixed steps", (range, length, usage, windows) => {
    expect(fullStatsSpanOf(range, NOW)).toEqual({
      from: new Date(NOW.getTime() - length),
      to: NOW,
      usageStepMs: usage,
      windowsStepMs: windows,
    });
  });
});

describe("stepsOf", () => {
  it("gives every step from the one the start falls in to the one now falls in, in UTC", () => {
    const { from, to, usageStepMs } = fullStatsSpanOf("24h", NOW);

    const steps = stepsOf(from, to, usageStepMs);

    expect(steps).toHaveLength(25);
    expect(steps[0]).toEqual(new Date("2026-11-16T10:00:00.000Z"));
    expect(steps.at(-1)).toEqual(new Date("2026-11-17T10:00:00.000Z"));
  });
});

describe("stepEndOf", () => {
  it("ends the step still going on, so a read in steps reaches the last bucket", () => {
    expect(stepEndOf(NOW, HOUR_MS)).toEqual(new Date("2026-11-17T11:00:00.000Z"));
    expect(stepEndOf(new Date("2026-11-17T11:00:00.000Z"), HOUR_MS)).toEqual(
      new Date("2026-11-17T12:00:00.000Z"),
    );
  });
});

describe("usageBucketsOf", () => {
  it("joins tokens and estimated cost by name in each step, a step with nothing holding no group", () => {
    const steps = stepsOf(new Date("2026-11-17T07:00:00.000Z"), NOW, HOUR_MS);

    const buckets = usageBucketsOf(
      {
        tokens: [
          { name: "opus", points: [{ at: new Date("2026-11-17T07:00:00.000Z"), value: 500 }] },
          {
            name: "",
            points: [
              { at: new Date("2026-11-17T09:30:00.000Z"), value: 40 },
              { at: new Date("2026-11-17T09:00:00.000Z"), value: 0 },
              { at: new Date("2026-11-10T09:00:00.000Z"), value: 999 },
            ],
          },
        ],
        estimatedCostUsd: [
          { name: "opus", points: [{ at: new Date("2026-11-17T07:00:00.000Z"), value: 1.5 }] },
          { name: "sonnet", points: [{ at: new Date("2026-11-17T09:00:00.000Z"), value: 0.2 }] },
        ],
      },
      steps,
      HOUR_MS,
    );

    expect(buckets).toEqual([
      {
        at: new Date("2026-11-17T07:00:00.000Z"),
        groups: [{ name: "opus", tokens: 500, estimatedCostUsd: 1.5 }],
      },
      { at: new Date("2026-11-17T08:00:00.000Z"), groups: [] },
      {
        at: new Date("2026-11-17T09:00:00.000Z"),
        groups: [
          { name: "", tokens: 40, estimatedCostUsd: 0 },
          { name: "sonnet", tokens: 0, estimatedCostUsd: 0.2 },
        ],
      },
      { at: new Date("2026-11-17T10:00:00.000Z"), groups: [] },
    ]);
  });
});

describe("costliestOf", () => {
  it("lists the 10 known Tasks with the most estimated cost, most first", () => {
    const spend = Array.from({ length: 12 }, (_, index) => aTaskSpend(`t${index}`, index + 1));
    const tasks = spend.map(({ taskId }) => aTask(taskId)).filter(({ id }) => id !== "t11");

    const { tasks: costliest } = costliestOf({
      spend: { tasks: spend, initiatives: [] },
      tasks,
      initiatives: [],
      ...NO_ENGINES,
    });

    expect(costliest).toHaveLength(COSTLIEST);
    expect(costliest.map(({ taskId }) => taskId)).toEqual([
      "t10",
      "t9",
      "t8",
      "t7",
      "t6",
      "t5",
      "t4",
      "t3",
      "t2",
      "t1",
    ]);
    expect(costliest[0]).toMatchObject({ title: "Task t10", projectId: "office" });
  });

  it("numbers each Stage's tries in the order they first ran, its calls outside a Stage apart", () => {
    const spend = aTaskSpend("t1", 10, [
      aRun("Review", "r3", 30, 1),
      aRun("Implement", "r2", 20, 2),
      aRun("Implement", "r1", 10, 3),
      aRun("", "", 5, 0.5),
    ]);

    const [task] = costliestOf({
      spend: { tasks: [spend], initiatives: [] },
      tasks: [aTask("t1")],
      initiatives: [],
      ...NO_ENGINES,
    }).tasks;

    expect(task).toMatchObject({
      tokens: 10_000,
      estimatedCostUsd: 10,
      stages: [
        {
          stageName: "Implement",
          tries: [
            { try: 1, tokens: 300, estimatedCostUsd: 3 },
            { try: 2, tokens: 200, estimatedCostUsd: 2 },
          ],
        },
        { stageName: "Review", tries: [{ try: 1, tokens: 100, estimatedCostUsd: 1 }] },
      ],
      outsideStages: { tokens: 50, estimatedCostUsd: 0.5 },
    });
  });

  it("names a plain try's model and engine as its Stage run named the engine", () => {
    const [task] = costliestOf({
      spend: { tasks: [aTaskSpend("t1", 3, [aRun("Implement", "1", 10, 3)])], initiatives: [] },
      tasks: [aTask("t1")],
      initiatives: [],
      stageRunEngines: [aRunOnEngines("t1", 1, "work", "Work")],
      engines: [{ engineId: "work", name: "Work renamed" }],
    }).tasks;

    expect(task?.stages[0]?.tries).toEqual([
      {
        try: 1,
        tokens: 300,
        estimatedCostUsd: 3,
        ranOn: [
          {
            engineName: "Work",
            model: "claude-opus-5-5",
            standInForEngineName: undefined,
            tokens: 300,
            estimatedCostUsd: 3,
          },
        ],
      },
    ]);
  });

  it("marks a try on a Stand-in Engine with the engine it stood in for", () => {
    const [task] = costliestOf({
      spend: {
        tasks: [aTaskSpend("t1", 1, [aRun("Implement", "2", 10, 1, { engineId: "personal" })])],
        initiatives: [],
      },
      tasks: [aTask("t1")],
      initiatives: [],
      stageRunEngines: [
        aRunOnEngines("t1", 2, "personal", "Personal", {
          standInFor: { engineId: "work", engineName: "Work" },
        }),
      ],
      engines: [],
    }).tasks;

    expect(task?.stages[0]?.tries[0]?.ranOn).toEqual([
      expect.objectContaining({ engineName: "Personal", standInForEngineName: "Work" }),
    ]);
  });

  it("lists each engine and model a switched try ran on, most cost first, as one try", () => {
    const [task] = costliestOf({
      spend: {
        tasks: [
          aTaskSpend("t1", 1.4, [
            aRun("Implement", "1", 10, 0.4, { engineId: "personal" }),
            aRun("Implement", "1", 5, 1, { engineId: "work" }),
          ]),
        ],
        initiatives: [],
      },
      tasks: [aTask("t1")],
      initiatives: [],
      stageRunEngines: [SWITCHED_RUN],
      engines: [],
    }).tasks;

    expect(task?.stages).toEqual([
      {
        stageName: "Implement",
        tries: [
          {
            try: 1,
            tokens: 140,
            estimatedCostUsd: 1.4,
            ranOn: [
              {
                engineName: "Work",
                model: "claude-opus-5-5",
                standInForEngineName: undefined,
                tokens: 100,
                estimatedCostUsd: 1,
              },
              {
                engineName: "Personal",
                model: "claude-opus-5-5",
                standInForEngineName: "Work",
                tokens: 40,
                estimatedCostUsd: 0.4,
              },
            ],
          },
        ],
      },
    ]);
  });

  it("names an engine its Stage run kept no name for by its name now, else as a removed engine", () => {
    const [task] = costliestOf({
      spend: {
        tasks: [
          aTaskSpend("t1", 3, [
            aRun("Implement", "1", 10, 2, { engineId: "work" }),
            aRun("Implement", "1", 10, 1, { engineId: "gone", model: "claude-sonnet-5-5" }),
          ]),
        ],
        initiatives: [],
      },
      tasks: [aTask("t1")],
      initiatives: [],
      ...NO_ENGINES,
      engines: [{ engineId: "work", name: "Work" }],
    }).tasks;

    expect(
      task?.stages[0]?.tries[0]?.ranOn.map(({ engineName, model }) => [engineName, model]),
    ).toEqual([
      ["Work", "claude-opus-5-5"],
      ["Removed engine", "claude-sonnet-5-5"],
    ]);
  });

  it("gives an Initiative its known Tasks, most first, with what each ran on, and its own Threads; unknown ones are left out", () => {
    const { initiatives } = costliestOf({
      spend: {
        tasks: [],
        initiatives: [
          {
            initiativeId: "i1",
            tokens: 900,
            estimatedCostUsd: 9,
            tasks: [
              anInitiativePart("t1", "1", "personal", 0.4),
              anInitiativePart("t1", "1", "work", 0.6),
              anInitiativePart("gone", "1", "work", 3),
              anInitiativePart("t2", "", "work", 4),
              anInitiativePart("", "", "work", 1),
            ],
          },
          { initiativeId: "forgotten", tokens: 9_000, estimatedCostUsd: 90, tasks: [] },
        ],
      },
      tasks: [aTask("t1"), aTask("t2")],
      initiatives: [{ initiativeId: "i1", title: "Stats", projectIds: ["office", "web"] }],
      stageRunEngines: [SWITCHED_RUN],
      engines: [{ engineId: "work", name: "Work" }],
    });

    expect(initiatives).toEqual([
      {
        initiativeId: "i1",
        title: "Stats",
        projectIds: ["office", "web"],
        tokens: 900,
        estimatedCostUsd: 9,
        tasks: [
          { taskId: "t2", title: "Task t2", tokens: 400, estimatedCostUsd: 4, ranOn: [onWork(4)] },
          {
            taskId: "t1",
            title: "Task t1",
            tokens: 100,
            estimatedCostUsd: 1,
            ranOn: [
              onWork(0.6),
              {
                engineName: "Personal",
                model: "claude-opus-5-5",
                standInForEngineName: "Work",
                tokens: 40,
                estimatedCostUsd: 0.4,
              },
            ],
          },
        ],
        ownThreads: { tokens: 100, estimatedCostUsd: 1 },
      },
    ]);
  });
});

describe("windowsOverTimeOf", () => {
  it("gives each engine with Usage windows in the order given, its missing window empty", () => {
    const at = new Date("2026-11-17T09:00:00.000Z");
    const earlier = new Date("2026-11-17T08:00:00.000Z");

    const windows = windowsOverTimeOf(
      [
        {
          engineId: "claude",
          window: "five_hour",
          points: [
            { at, value: 40 },
            { at: earlier, value: 20 },
          ],
        },
        { engineId: "removed", window: "five_hour", points: [{ at, value: 99 }] },
        { engineId: "codex", window: "seven_day", points: [{ at, value: 5 }] },
      ],
      [
        { engineId: "codex", name: "Codex", hasWindows: true },
        { engineId: "api", name: "API", hasWindows: false },
        { engineId: "claude", name: "Claude Code", hasWindows: true },
      ],
    );

    expect(windows).toEqual([
      { engineId: "codex", name: "Codex", fiveHour: [], sevenDay: [{ at, percentUsed: 5 }] },
      {
        engineId: "claude",
        name: "Claude Code",
        fiveHour: [
          { at: earlier, percentUsed: 20 },
          { at, percentUsed: 40 },
        ],
        sevenDay: [],
      },
    ]);
  });
});

function aSpan(taskId: string, hour: number): StatsStageRunSpan {
  return {
    engineId: "claude",
    taskId,
    stageName: "Implement",
    startedAt: new Date(Date.UTC(2026, 10, 17, hour)),
    endedAt: undefined,
  };
}

describe("runningOf", () => {
  it("gives each run with its Task's title and Project, oldest first, narrowed by the filter", () => {
    const tasks = [aTask("ours"), aTask("theirs", "other")];
    const spans = [aSpan("ours", 9), aSpan("theirs", 7), aSpan("gone", 8), aSpan("ours", 6)];

    expect(runningOf(spans, tasks, "all").map(({ taskId }) => taskId)).toEqual([
      "ours",
      "theirs",
      "ours",
    ]);
    expect(runningOf(spans, tasks, ["office"])).toEqual([
      { ...aSpan("ours", 6), title: "Task ours", projectId: "office" },
      { ...aSpan("ours", 9), title: "Task ours", projectId: "office" },
    ]);
  });
});

describe("holdsNoData", () => {
  const empty = {
    usage: { tokens: [{ name: "opus", points: [{ at: NOW, value: 0 }] }], estimatedCostUsd: [] },
    costliest: { tasks: [], initiatives: [] },
    windows: [{ engineId: "claude", window: "five_hour" as const, points: [] }],
  };

  it("holds no data when no answer has anything", () => {
    expect(holdsNoData(empty)).toBe(true);
  });

  it.each([
    [
      "a usage point",
      {
        usage: { tokens: [], estimatedCostUsd: [{ name: "", points: [{ at: NOW, value: 0.1 }] }] },
      },
    ],
    ["a Task", { costliest: { tasks: [aTaskSpend("t1", 1)], initiatives: [] } }],
    [
      "a window point",
      {
        windows: [
          { engineId: "claude", window: "seven_day" as const, points: [{ at: NOW, value: 0 }] },
        ],
      },
    ],
  ])("holds data with %s", (_, part) => {
    expect(holdsNoData({ ...empty, ...part })).toBe(false);
  });
});
