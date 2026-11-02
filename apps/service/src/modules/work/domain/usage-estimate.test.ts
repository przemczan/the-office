import { describe, expect, it } from "vitest";
import {
  historyUsage,
  plannerUsage,
  stageEngineAndModel,
  tasksInHistory,
  type EstimatedStage,
  type StageTokens,
  type EngineWindowRatios,
  type StageUsage,
} from "./usage-estimate.js";

// Implement on the Agent SDK and Review on the `-p` fallback: both spend on the Claude Code account.
const IMPLEMENT: EstimatedStage = {
  key: "implement",
  engineId: "claude-code",
  model: "claude-opus-5-5",
};
const REVIEW: EstimatedStage = {
  key: "review",
  engineId: "claude-code",
  model: "claude-haiku-5-5",
};
const SUMMARY: EstimatedStage = {
  key: "summary",
  engineId: "openai-compatible-api",
  model: "llama",
};

function tokens(input: number, output = 0, cacheRead = 0, cacheCreation = 0): StageTokens {
  return { input, output, cacheRead, cacheCreation };
}

// Only a Claude Code engine's account has windows, so only its engine id has ratios.
const WINDOW_RATIOS: EngineWindowRatios = new Map([
  ["claude-code", { fiveHour: 0.001, sevenDay: 0.0005 }],
]);

function usage(stageTokens: StageTokens, samples: number): StageUsage {
  return { tokens: stageTokens, samples };
}

describe("stageEngineAndModel", () => {
  it("takes the cascade's engine, and the Stage's own model or else the cascade's", () => {
    const applying = { engineId: "claude-code", model: "claude-opus-5-5" };

    expect(stageEngineAndModel({ key: "a", name: "A", role: "developer" }, applying)).toEqual({
      engineId: "claude-code",
      model: "claude-opus-5-5",
    });
    expect(
      stageEngineAndModel(
        { key: "a", name: "A", role: "developer", model: "claude-haiku-5-5" },
        applying,
      ),
    ).toEqual({ engineId: "claude-code", model: "claude-haiku-5-5" });
  });
});

describe("tasksInHistory", () => {
  it("counts the most samples any of the Stages has", () => {
    const history = new Map([
      ["implement", usage(tokens(1), 4)],
      ["review", usage(tokens(1), 2)],
    ]);

    expect(tasksInHistory([IMPLEMENT, REVIEW], history)).toBe(4);
    expect(tasksInHistory([IMPLEMENT], new Map())).toBe(0);
    expect(tasksInHistory([], history)).toBe(0);
  });
});

describe("historyUsage", () => {
  it("sums each Stage's median counted tokens and cost per engine id, windows by its ratios", () => {
    const history = new Map([
      ["implement", usage(tokens(1000, 200, 5000, 300), 3)],
      ["review", usage(tokens(400, 100), 3)],
      ["summary", usage(tokens(50, 50), 3)],
    ]);
    const costs = new Map([
      ["implement", 0.3],
      ["review", 0.05],
      ["summary", 0.01],
    ]);

    expect(historyUsage([IMPLEMENT, REVIEW, SUMMARY], history, costs, WINDOW_RATIOS)).toEqual([
      {
        engineId: "claude-code",
        tokens: 2000,
        windows: { fiveHour: 2, sevenDay: 1 },
        cost: 0.35,
      },
      {
        engineId: "openai-compatible-api",
        tokens: 100,
        windows: undefined,
        cost: 0.01,
      },
    ]);
  });

  it("adds nothing for a Stage that never ran, and no cost when one Stage that ran has none", () => {
    const history = new Map([
      ["implement", usage(tokens(1000), 3)],
      ["review", usage(tokens(500), 3)],
    ]);
    const unpriced = new Map([
      ["implement", 0.3],
      ["review", undefined],
    ]);

    expect(historyUsage([IMPLEMENT, REVIEW], history, unpriced, WINDOW_RATIOS)).toEqual([
      {
        engineId: "claude-code",
        tokens: 1500,
        windows: { fiveHour: 1.5, sevenDay: 0.75 },
        cost: undefined,
      },
    ]);
    expect(
      historyUsage(
        [IMPLEMENT, REVIEW],
        new Map([["implement", usage(tokens(1000), 3)]]),
        new Map([["implement", 0.3]]),
        WINDOW_RATIOS,
      ),
    ).toEqual([
      { engineId: "claude-code", tokens: 1000, windows: { fiveHour: 1, sevenDay: 0.5 }, cost: 0.3 },
    ]);
  });

  it("gives no window without its ratio", () => {
    const fiveHourOnly: EngineWindowRatios = new Map([
      ["claude-code", { fiveHour: 0.001, sevenDay: undefined }],
    ]);

    expect(
      historyUsage(
        [IMPLEMENT],
        new Map([["implement", usage(tokens(1000), 3)]]),
        new Map([["implement", 0.3]]),
        fiveHourOnly,
      )[0]?.windows,
    ).toEqual({ fiveHour: 1, sevenDay: undefined });
  });
});

describe("plannerUsage", () => {
  it("splits the Planner's tokens evenly over the Agent Stages per engine id, with window % and cost by the ratios", () => {
    expect(plannerUsage([IMPLEMENT, REVIEW, SUMMARY], 9000, WINDOW_RATIOS, 0.5)).toEqual([
      {
        engineId: "claude-code",
        tokens: 6000,
        windows: { fiveHour: 6, sevenDay: 3 },
        cost: 3000,
      },
      {
        engineId: "openai-compatible-api",
        tokens: 3000,
        windows: undefined,
        cost: 1500,
      },
    ]);
  });

  it("gives tokens alone when no ratio is known", () => {
    const unknown: EngineWindowRatios = new Map([
      ["claude-code", { fiveHour: undefined, sevenDay: undefined }],
    ]);

    expect(plannerUsage([IMPLEMENT], 5000, unknown, undefined)).toEqual([
      {
        engineId: "claude-code",
        tokens: 5000,
        windows: { fiveHour: undefined, sevenDay: undefined },
        cost: undefined,
      },
    ]);
  });
});
