import { describe, expect, it } from "vitest";
import { aStageRun } from "./stage-run.fixtures.js";
import { NO_STAGE_TOKENS, type StageTokens, type UsageWindowReading } from "./stage-run.js";
import {
  latestTasksRuns,
  stageUsages,
  tokensByModel,
  usageRatios,
  windowChangeOf,
} from "./usage-history.js";

const RESET = new Date("2026-11-01T15:00:00Z");

function tokens(input: number, output = 0, cacheCreation = 0, cacheRead = 0): StageTokens {
  return { input, output, cacheRead, cacheCreation };
}

function aReading(
  fiveHour: number,
  officeTokensSoFar: number,
  fields: Partial<UsageWindowReading> = {},
): UsageWindowReading {
  return {
    fiveHour: { percentUsed: fiveHour, resetsAt: RESET },
    sevenDay: { percentUsed: 10, resetsAt: new Date("2026-11-05T00:00:00Z") },
    readAt: new Date("2026-11-01T12:00:00Z"),
    officeTokensSoFar: tokens(officeTokensSoFar),
    ...fields,
  };
}

/** A run of 1,000 tokens over which the 5-hour window went from 20% to 30%, as the Office used 1,000. */
const aReadRun = (fields: Parameters<typeof aStageRun>[0] = {}) =>
  aStageRun({
    tokens: tokens(1_000),
    usageWindowsAtStart: aReading(20, 5_000),
    usageWindowsAtEnd: aReading(30, 6_000, { readAt: new Date("2026-11-01T12:10:00Z") }),
    ...fields,
  });

describe("a Stage's samples", () => {
  it("takes the median of each token kind, one sample per done Task", () => {
    const usage = stageUsages([
      aStageRun({ taskId: "a", tokens: tokens(100, 10, 1, 7) }),
      aStageRun({ taskId: "b", tokens: tokens(300, 30, 3, 5) }),
      aStageRun({ taskId: "c", tokens: tokens(200, 50, 2, 6) }),
    ]).get("implement");

    expect(usage).toMatchObject({ tokens: tokens(200, 30, 2, 6), samples: 3 });
  });

  it("takes the mean of the two middle samples when there is an even number", () => {
    const usage = stageUsages([
      aStageRun({ taskId: "a", tokens: tokens(100) }),
      aStageRun({ taskId: "b", tokens: tokens(200) }),
    ]).get("implement");

    expect(usage?.tokens.input).toBe(150);
  });

  it("sums a Task's runs of the Stage, so loops and send-backs count", () => {
    const usages = stageUsages([
      aStageRun({ taskId: "a", number: 1, tokens: tokens(100) }),
      aStageRun({ taskId: "a", number: 2, stageKey: "review", tokens: tokens(40) }),
      aStageRun({ taskId: "a", number: 3, tokens: tokens(50) }),
    ]);

    expect(usages.get("implement")).toMatchObject({ tokens: tokens(150), samples: 1 });
    expect(usages.get("review")).toMatchObject({ tokens: tokens(40), samples: 1 });
  });

  it("gives a Task that never ran a Stage no sample of it", () => {
    const usages = stageUsages([
      aStageRun({ taskId: "a", stageKey: "review" }),
      aStageRun({ taskId: "b", stageKey: "implement" }),
    ]);

    expect(usages.get("review")?.samples).toBe(1);
    expect(usages.get("implement")?.samples).toBe(1);
  });

  it("gives the median window change over the samples whose every run's readings count", () => {
    const usage = stageUsages([
      aReadRun({ taskId: "a", number: 1 }),
      aReadRun({ taskId: "a", number: 2 }),
      aReadRun({ taskId: "b" }),
      aReadRun({ taskId: "c", number: 1 }),
      aReadRun({ taskId: "c", number: 2, usageWindowsAtEnd: undefined }),
    ]).get("implement");

    expect(usage?.samples).toBe(3);
    expect(usage?.windows.fiveHour).toEqual({ percentUsed: 15, samples: 2 });
    expect(usage?.windows.sevenDay).toEqual({ percentUsed: 0, samples: 2 });
  });

  it("has no window change when no sample's readings count", () => {
    const usage = stageUsages([aStageRun()]).get("implement");

    expect(usage?.windows).toEqual({ fiveHour: undefined, sevenDay: undefined });
  });
});

describe("a run's window change", () => {
  it("is the window's change scaled by the run's share of the Office's tokens", () => {
    const run = aReadRun({ tokens: tokens(250, 100, 150, 9_999) });

    expect(windowChangeOf(run, "fiveHour")).toBe(5);
  });

  it("is the whole change when the run's tokens are all the Office's", () => {
    expect(windowChangeOf(aReadRun(), "fiveHour")).toBe(10);
  });

  it("counts a window that began during the run from 0%", () => {
    const run = aReadRun({
      usageWindowsAtStart: aReading(0, 5_000, {
        fiveHour: { percentUsed: 0, resetsAt: undefined },
      }),
    });

    expect(windowChangeOf(run, "fiveHour")).toBe(30);
  });

  it("is undefined without both readings", () => {
    expect(
      windowChangeOf(aReadRun({ usageWindowsAtStart: undefined }), "fiveHour"),
    ).toBeUndefined();
    expect(windowChangeOf(aReadRun({ usageWindowsAtEnd: undefined }), "fiveHour")).toBeUndefined();
  });

  it("is undefined when the window reset during the run", () => {
    const run = aReadRun({
      usageWindowsAtEnd: aReading(30, 6_000, { readAt: RESET }),
    });

    expect(windowChangeOf(run, "fiveHour")).toBeUndefined();
    expect(windowChangeOf(run, "sevenDay")).toBe(0);
  });

  it("is undefined when the window's use went down", () => {
    const run = aReadRun({ usageWindowsAtEnd: aReading(5, 6_000) });

    expect(windowChangeOf(run, "fiveHour")).toBeUndefined();
  });

  it("is undefined when the Office's tokens went down or didn't move, as across a restart", () => {
    expect(
      windowChangeOf(aReadRun({ usageWindowsAtEnd: aReading(30, 100) }), "fiveHour"),
    ).toBeUndefined();
    expect(
      windowChangeOf(aReadRun({ usageWindowsAtEnd: aReading(30, 5_000) }), "fiveHour"),
    ).toBeUndefined();
  });
});

describe("the latest done Tasks", () => {
  it("keeps the runs of the Tasks whose last run ended latest", () => {
    const runs = [
      aStageRun({ taskId: "old", endedAt: new Date(1_000) }),
      aStageRun({ taskId: "new", number: 1, endedAt: new Date(500) }),
      aStageRun({ taskId: "new", number: 2, endedAt: new Date(3_000) }),
      aStageRun({ taskId: "middle", endedAt: new Date(2_000) }),
    ];

    expect(latestTasksRuns(runs, 2).map(({ taskId }) => taskId)).toEqual(["new", "new", "middle"]);
  });

  it("leaves out a run that hasn't ended", () => {
    const runs = [aStageRun({ taskId: "a", endedAt: undefined })];

    expect(latestTasksRuns(runs)).toEqual([]);
  });

  it("keeps 20 Tasks by default", () => {
    const runs = Array.from({ length: 25 }, (_, index) =>
      aStageRun({ taskId: `task-${index}`, endedAt: new Date(index) }),
    );

    expect(new Set(latestTasksRuns(runs).map(({ taskId }) => taskId)).size).toBe(20);
  });
});

describe("the Office-wide ratios", () => {
  it("gives window % per token over the runs whose readings count", () => {
    const ratios = usageRatios(
      [aReadRun(), aReadRun({ number: 2, tokens: tokens(500), usageWindowsAtEnd: undefined })],
      [],
    );

    expect(ratios.percentUsedPerToken).toEqual({ fiveHour: 10 / 1_000, sevenDay: 0 });
  });

  it("gives dollars per token over the priced tokens only", () => {
    const ratios = usageRatios(
      [],
      [
        { tokens: tokens(1_000, 0, 0, 50_000), dollars: 2 },
        { tokens: tokens(3_000), dollars: 1 },
        { tokens: tokens(9_000), dollars: undefined },
      ],
    );

    expect(ratios.dollarsPerToken).toBe(3 / 4_000);
  });

  it("gives none without runs to learn from", () => {
    expect(usageRatios([aStageRun()], [])).toEqual({
      percentUsedPerToken: { fiveHour: undefined, sevenDay: undefined },
      dollarsPerToken: undefined,
    });
  });

  it("sums tokens by engine and model, leaving out runs kept before they were recorded", () => {
    const sums = tokensByModel([
      aStageRun({ engine: "agent-sdk", model: "claude-haiku-5-5", tokens: tokens(10) }),
      aStageRun({ number: 2, engine: "agent-sdk", model: "claude-haiku-5-5", tokens: tokens(5) }),
      aStageRun({
        number: 3,
        engine: "claude-code-p",
        model: "claude-haiku-5-5",
        tokens: tokens(1),
      }),
      aStageRun({ number: 4, tokens: tokens(99) }),
      aStageRun({ number: 5, engine: "agent-sdk", tokens: NO_STAGE_TOKENS }),
    ]);

    expect(sums).toEqual([
      { engine: "agent-sdk", model: "claude-haiku-5-5", tokens: tokens(15) },
      { engine: "claude-code-p", model: "claude-haiku-5-5", tokens: tokens(1) },
    ]);
  });
});
