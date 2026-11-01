import { describe, expect, it } from "vitest";
import type { AgentStage } from "./stage.js";
import { budgetOutcome, budgetReached, stageBudget, tokensWords } from "./stage-budget.js";
import { NO_STAGE_TOKENS, type StageRun, type StageRunDecision } from "./stage-run.js";

const implement: AgentStage = {
  kind: "agent",
  key: "implement",
  name: "Implement",
  optional: false,
  role: "developer",
  brief: "Build it.",
  session: "fresh",
  budget: 250_000,
};

function aRun(stageKey: string, decisions: StageRunDecision[]): StageRun {
  return {
    id: `run-${stageKey}`,
    taskId: "task-1",
    stageKey,
    number: 1,
    carriedFailure: undefined,
    threadId: undefined,
    session: undefined,
    headCommit: undefined,
    commandRuns: [],
    tokens: NO_STAGE_TOKENS,
    engine: undefined,
    model: undefined,
    usageWindowsAtStart: undefined,
    usageWindowsAtEnd: undefined,
    decisions,
    heldBy: undefined,
    sentBack: undefined,
    gateAction: undefined,
    outcome: undefined,
    startedAt: new Date(0),
    endedAt: undefined,
  };
}

const raised = (tokens: number): StageRunDecision => ({
  id: "decision-1",
  kind: "budget",
  options: [],
  answer: { kind: "raise-budget", tokens },
});

describe("stageBudget", () => {
  it("adds every raise the user gave the Stage, and none given another", () => {
    const runs = [aRun("implement", [raised(250_000)]), aRun("review", [raised(40_000)])];

    expect(stageBudget(implement, runs)).toBe(500_000);
    expect(stageBudget(implement, [])).toBe(250_000);
  });
});

describe("budgetReached", () => {
  it("is reached once the Task's tokens so far come to the Stage's budget", () => {
    expect(budgetReached(implement, [], 249_999)).toBeUndefined();
    expect(budgetReached(implement, [], 250_000)).toEqual({ used: 250_000, budget: 250_000 });
  });

  it("ends the run failed with the reason, in the web's token words", () => {
    expect(budgetOutcome("Implement", { used: 261_400, budget: 250_000 })).toEqual({
      status: "failed",
      error:
        'The Task\'s tokens reached the budget of "Implement": 261k of 250k. The Office stopped before the next engine call.',
      budgetReached: { used: 261_400, budget: 250_000 },
    });
    expect(tokensWords(1_500)).toBe("1.5k");
  });
});
