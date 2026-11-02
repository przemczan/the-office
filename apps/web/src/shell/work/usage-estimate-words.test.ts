import { describe, expect, it } from "vitest";
import { usageEstimateWords } from "./usage-estimate-words.ts";

describe("usageEstimateWords", () => {
  it("gives each ticked measure of one engine id and the history it came from", () => {
    expect(
      usageEstimateWords({
        basis: { source: "history", tasks: 4 },
        engines: [
          {
            engineId: "claude-code",
            tokens: 120_400,
            fiveHourWindow: 6.04,
            sevenDayWindow: 12.6,
            cost: 1.2,
          },
        ],
      }),
    ).toBe(
      "Expected: 120k tokens · 6% of the 5-hour window · 13% of the 7-day window · $1.20, from the history of 4 done Tasks.",
    );
  });

  it("names each engine id when the Task spends on several, leaving windows out where there are none", () => {
    expect(
      usageEstimateWords({
        basis: { source: "planner" },
        engines: [
          { engineId: "claude-code", tokens: 60_000, fiveHourWindow: null, cost: 0.004 },
          { engineId: "openai-compatible-api", tokens: 40_000, fiveHourWindow: null, cost: null },
        ],
      }),
    ).toBe(
      "Expected: Claude Code engines: 60k tokens · no estimate of the 5-hour window · under $0.01; OpenAI-compatible API: 40k tokens · no cost, from the Planner's estimate.",
    );
  });

  it("says there is no estimate without history or the Planner's", () => {
    expect(usageEstimateWords({ basis: { source: "none" }, engines: [] })).toBe(
      "No estimate: fewer than 3 done Tasks to learn from, and no Planner's estimate.",
    );
  });
});
