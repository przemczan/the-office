import { describe, expect, it } from "vitest";
import {
  historyUsage,
  plannerUsage,
  stageEngineAndModel,
  tasksInHistory,
  type EstimatedStage,
  type StageTokens,
  type StageUsage,
  type UsageRatios,
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

const readsWindowsOnClaudeCode = (engineId: string): boolean => engineId === "claude-code";

function tokens(input: number, output = 0, cacheRead = 0, cacheCreation = 0): StageTokens {
  return { input, output, cacheRead, cacheCreation };
}

function usage(
  stageTokens: StageTokens,
  samples: number,
  fiveHour?: number,
  sevenDay?: number,
): StageUsage {
  return {
    tokens: stageTokens,
    samples,
    windows: {
      fiveHour: fiveHour === undefined ? undefined : { percentUsed: fiveHour, samples },
      sevenDay: sevenDay === undefined ? undefined : { percentUsed: sevenDay, samples },
    },
  };
}

describe("stageEngineAndModel", () => {
  it("takes the Role's engine, and the Stage's own model or else the Role's", () => {
    const role = { engine: "agent-sdk", model: "claude-opus-5-5" } as const;

    expect(stageEngineAndModel({ key: "a", name: "A", role: "developer" }, role)).toEqual(role);
    expect(
      stageEngineAndModel(
        { key: "a", name: "A", role: "developer", model: "claude-haiku-5-5" },
        role,
      ),
    ).toEqual({ engine: "agent-sdk", model: "claude-haiku-5-5" });
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
  it("sums each Stage's median counted tokens, windows and cost per engine id", () => {
    const history = new Map([
      ["implement", usage(tokens(1000, 200, 5000, 300), 3, 2, 0.5)],
      ["review", usage(tokens(400, 100), 3, 1, 0.25)],
      ["summary", usage(tokens(50, 50), 3)],
    ]);
    const costs = new Map([
      ["implement", 0.3],
      ["review", 0.05],
      ["summary", 0.01],
    ]);

    expect(
      historyUsage([IMPLEMENT, REVIEW, SUMMARY], history, costs, readsWindowsOnClaudeCode),
    ).toEqual([
      {
        engineId: "claude-code",
        tokens: 2000,
        windows: { fiveHour: 3, sevenDay: 0.75 },
        cost: 0.35,
      },
      {
        engineId: "openai-compatible-api",
        tokens: 100,
        windows: { fiveHour: undefined, sevenDay: undefined },
        cost: 0.01,
      },
    ]);
  });

  it("adds nothing for a Stage that never ran, and no window or cost when one Stage that ran has none", () => {
    const history = new Map([
      ["implement", usage(tokens(1000), 3, 2)],
      ["review", usage(tokens(500), 3, undefined, undefined)],
    ]);
    const unpriced = new Map([
      ["implement", 0.3],
      ["review", undefined],
    ]);

    expect(historyUsage([IMPLEMENT, REVIEW], history, unpriced, readsWindowsOnClaudeCode)).toEqual([
      {
        engineId: "claude-code",
        tokens: 1500,
        windows: { fiveHour: undefined, sevenDay: undefined },
        cost: undefined,
      },
    ]);
    expect(
      historyUsage(
        [IMPLEMENT, REVIEW],
        new Map([["implement", usage(tokens(1000), 3, 2, 1)]]),
        new Map([["implement", 0.3]]),
        readsWindowsOnClaudeCode,
      ),
    ).toEqual([
      { engineId: "claude-code", tokens: 1000, windows: { fiveHour: 2, sevenDay: 1 }, cost: 0.3 },
    ]);
  });
});

describe("plannerUsage", () => {
  const ratios: UsageRatios = {
    percentUsedPerToken: { fiveHour: 0.001, sevenDay: undefined },
    dollarsPerToken: 0.5,
  };

  it("splits the Planner's tokens evenly over the Agent Stages per engine id, with window % and cost by the ratios", () => {
    expect(
      plannerUsage([IMPLEMENT, REVIEW, SUMMARY], 9000, ratios, readsWindowsOnClaudeCode),
    ).toEqual([
      {
        engineId: "claude-code",
        tokens: 6000,
        windows: { fiveHour: 6, sevenDay: undefined },
        cost: 3000,
      },
      {
        engineId: "openai-compatible-api",
        tokens: 3000,
        windows: { fiveHour: undefined, sevenDay: undefined },
        cost: 1500,
      },
    ]);
  });

  it("gives tokens alone when no done Task gives a ratio", () => {
    const none: UsageRatios = {
      percentUsedPerToken: { fiveHour: undefined, sevenDay: undefined },
      dollarsPerToken: undefined,
    };

    expect(plannerUsage([IMPLEMENT], 5000, none, readsWindowsOnClaudeCode)).toEqual([
      {
        engineId: "claude-code",
        tokens: 5000,
        windows: { fiveHour: undefined, sevenDay: undefined },
        cost: undefined,
      },
    ]);
  });
});
