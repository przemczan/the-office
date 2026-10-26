import type { AgentStage } from "./stage.js";
import type { BudgetReached, StageOutcome, StageRun } from "./stage-run.js";

/** The Stage's budget now: what it declares, plus every raise the user gave it in a Decision. */
export function stageBudget(stage: AgentStage, runs: readonly StageRun[]): number {
  return runs
    .filter(({ stageKey }) => stageKey === stage.key)
    .flatMap(({ decisions }) => decisions)
    .reduce(
      (budget, { kind, answer }) =>
        kind === "budget" && answer?.kind === "raise-budget" ? budget + answer.tokens : budget,
      stage.budget,
    );
}

/**
 * Whether the Task's tokens so far have reached the Stage's budget (spec §2.3: checked before
 * every engine call, against all of the Task's usage); undefined while they haven't.
 */
export function budgetReached(
  stage: AgentStage,
  runs: readonly StageRun[],
  used: number,
): BudgetReached | undefined {
  const budget = stageBudget(stage, runs);
  return used >= budget ? { used, budget } : undefined;
}

/** How a run ends when the Task's tokens reached the Stage's budget before an engine call. */
export function budgetOutcome(stageName: string, reached: BudgetReached): StageOutcome {
  return {
    status: "failed",
    error: `The Task's tokens reached the budget of "${stageName}": ${tokensWords(reached.used)} of ${tokensWords(reached.budget)}. The Office stopped before the next engine call.`,
    budgetReached: reached,
  };
}

/** "250k" for 250,000 tokens; small counts as they are, as the web shows tokens. */
export function tokensWords(tokens: number): string {
  if (tokens < 1_000) return String(tokens);
  if (tokens < 10_000) return `${(tokens / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(tokens / 1_000)}k`;
}
