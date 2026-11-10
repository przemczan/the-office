import { describe, expect, it } from "vitest";
import { aStageRun } from "./stage-run.fixtures.js";
import { NO_STAGE_TOKENS, type StageTokens } from "./stage-run.js";
import { dollarsPerToken, latestTasksRuns, stageUsages, tokensByModel } from "./usage-history.js";

function tokens(input: number, output = 0, cacheCreation = 0, cacheRead = 0): StageTokens {
  return { input, output, cacheRead, cacheCreation };
}

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

describe("the Office-wide dollars per token", () => {
  it("are taken over the priced tokens only", () => {
    expect(
      dollarsPerToken([
        { tokens: tokens(1_000, 0, 0, 50_000), dollars: 2 },
        { tokens: tokens(3_000), dollars: 1 },
        { tokens: tokens(9_000), dollars: undefined },
      ]),
    ).toBe(3 / 4_000);
  });

  it("are none without priced tokens", () => {
    expect(dollarsPerToken([{ tokens: tokens(9_000), dollars: undefined }])).toBeUndefined();
  });

  it("sums tokens by engine and model, leaving out runs kept before they were recorded", () => {
    const sums = tokensByModel([
      aStageRun({ engineId: "claude-code", model: "claude-haiku-5-5", tokens: tokens(10) }),
      aStageRun({
        number: 2,
        engineId: "claude-code",
        model: "claude-haiku-5-5",
        tokens: tokens(5),
      }),
      aStageRun({
        number: 3,
        engineId: "lab",
        model: "claude-haiku-5-5",
        tokens: tokens(1),
      }),
      aStageRun({ number: 4, tokens: tokens(99) }),
      aStageRun({ number: 5, engineId: "claude-code", tokens: NO_STAGE_TOKENS }),
    ]);

    expect(sums).toEqual([
      { engineId: "claude-code", model: "claude-haiku-5-5", tokens: tokens(15) },
      { engineId: "lab", model: "claude-haiku-5-5", tokens: tokens(1) },
    ]);
  });
});
