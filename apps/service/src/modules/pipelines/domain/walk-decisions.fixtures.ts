import type { RouteAtLimit } from "./pipeline-walk.js";
import { ENDED_FAILED } from "./route.js";
import type { Stage } from "./stage.js";
import { goingBackOnFailure } from "./stage.fixtures.js";
import {
  NO_STAGE_TOKENS,
  type StageOutcome,
  type StageRun,
  type StageRunDecision,
} from "./stage-run.js";

// What walk-decisions.test.ts and walk-decisions.full.test.ts share: two Stages and their runs.

export const implement: Stage = {
  kind: "agent",
  key: "implement",
  name: "Implement",
  optional: false,
  role: "developer",
  brief: "Build it.",
  session: "fresh",
  budget: 100_000,
};
/** Tests, going back to Implement on failure as a previous release kept it, at most 3 times. */
export const tests: Stage = goingBackOnFailure(
  { kind: "script", key: "tests", name: "Tests", optional: false, command: "test" },
  "implement",
  3,
);

/** Tests' failure route back to Implement, followed as many times as it may. */
export const usedUpRouteBack: RouteAtLimit = {
  route: { to: "implement", toName: "Implement", condition: ENDED_FAILED, limit: 3 },
  times: 3,
  limit: 3,
  back: true,
};
/** Tests with no failure route, which only a Decision sends back. */
export const testsWithoutLoop: Stage = {
  kind: "script",
  key: "tests",
  name: "Tests",
  optional: false,
  command: "test",
};

export function aRun(
  stageKey: string,
  outcome: StageOutcome,
  decisions: StageRunDecision[] = [],
): StageRun {
  return {
    id: `run-${stageKey}`,
    taskId: "task-1",
    stageKey,
    number: 1,
    carriedFailure: undefined,
    threadId: "thread-1",
    roleKey: undefined,
    session: "fresh",
    headCommit: undefined,
    changedFiles: undefined,
    commandRuns: [],
    tokens: NO_STAGE_TOKENS,
    context: undefined,
    engineId: undefined,
    engineName: undefined,
    model: undefined,
    standInFor: undefined,
    engineSwitches: [],
    decisions,
    heldBy: undefined,
    heldByUser: undefined,
    published: undefined,
    choice: undefined,
    waitingSince: undefined,
    sentBack: undefined,
    gateAction: undefined,
    outcome,
    startedAt: new Date(0),
    endedAt: new Date(0),
  };
}

export const failed: StageOutcome = { status: "failed", error: "2 tests fail.\n\nThe output." };

export function sentBack(guidedBy?: string): StageRunDecision {
  return {
    id: "decision-1",
    kind: "no-retries-left",
    options: [{ kind: "more-rounds", rounds: 3 }, { kind: "accept-issues" }, { kind: "drop" }],
    answer: {
      kind: "one-more-round",
      guidance: "Mock the clock.",
      ...(guidedBy !== undefined && { guidedBy }),
    },
  };
}
