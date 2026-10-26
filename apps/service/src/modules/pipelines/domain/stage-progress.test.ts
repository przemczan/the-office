import { describe, expect, it } from "vitest";
import type { Stage } from "./stage.js";
import { stagesProgress } from "./stage-progress.js";
import {
  NO_STAGE_TOKENS,
  type CarriedFailure,
  type StageOutcome,
  type StageRun,
  type StageRunDecision,
  type StageTokens,
} from "./stage-run.js";

const implement: Stage = {
  kind: "agent",
  key: "implement",
  name: "Implement",
  optional: false,
  role: "developer",
  brief: "Do it.",
  session: "fresh",
  budget: 100_000,
};
const tests: Stage = {
  kind: "script",
  key: "tests",
  name: "Tests",
  optional: false,
  command: "test",
  onFailure: { goBackTo: "implement", rounds: 3 },
};
const review: Stage = { ...implement, key: "review", name: "Review & fix", optional: true };

const done: StageOutcome = { status: "done", summary: "Done." };
const failed: StageOutcome = { status: "failed", error: "2 failed." };

interface Ran {
  readonly stageKey: string;
  readonly outcome: StageOutcome | undefined;
  readonly decisions?: readonly StageRunDecision[];
  readonly tokens?: StageTokens;
  readonly carriedFailure?: CarriedFailure;
}

function runs(...ran: readonly Ran[]): StageRun[] {
  return ran.map((each, index) => ({
    id: `run-${index + 1}`,
    taskId: "task-1",
    number: index + 1,
    threadId: undefined,
    session: undefined,
    headCommit: undefined,
    commandRuns: [],
    startedAt: new Date(0),
    endedAt: each.outcome && new Date(0),
    ...each,
    tokens: each.tokens ?? NO_STAGE_TOKENS,
    decisions: each.decisions ?? [],
    carriedFailure: each.carriedFailure,
  }));
}

function statesOf(stages: readonly Stage[], ran: readonly StageRun[]): string[] {
  return stagesProgress(stages, ran).map(({ state }) => state);
}

describe("stagesProgress", () => {
  it("has every Stage pending before its first run, and a run without an end running", () => {
    expect(statesOf([implement, tests], [])).toEqual(["pending", "pending"]);
    expect(
      statesOf([implement, tests], runs({ stageKey: "implement", outcome: undefined })),
    ).toEqual(["running", "pending"]);
  });

  it("goes by each Stage's latest run, and tells where a failed one's loop went back", () => {
    const carried = { stageKey: "tests", error: "2 failed.", round: 1, rounds: 3 };
    const progress = stagesProgress(
      [implement, tests],
      runs(
        { stageKey: "implement", outcome: done },
        { stageKey: "tests", outcome: failed },
        { stageKey: "implement", outcome: undefined, carriedFailure: carried },
      ),
    );

    expect(progress.map(({ state }) => state)).toEqual(["running", "failed"]);
    expect(progress[0]?.runs.map(({ number }) => number)).toEqual([1, 3]);
    expect(progress[1]?.wentBack).toEqual({ stageKey: "implement", round: 1, rounds: 3 });
    expect(progress[0]?.wentBack).toBeUndefined();
  });

  it("waits on you while a Decision on the latest run is open, or an Agent's is about to open", () => {
    const open: StageRunDecision = {
      id: "decision-1",
      kind: "budget",
      options: [],
      answer: undefined,
    };
    const asks: StageOutcome = {
      status: "needs-decision",
      question: "Which page?",
      context: "",
      options: ["One", "Other"],
      recommendation: { option: 0, reason: "Room." },
    };

    expect(
      statesOf(
        [implement, tests],
        runs({ stageKey: "implement", outcome: failed, decisions: [open] }),
      ),
    ).toEqual(["waiting-on-you", "pending"]);
    expect(statesOf([implement], runs({ stageKey: "implement", outcome: asks }))).toEqual([
      "waiting-on-you",
    ]);
    expect(
      statesOf(
        [implement],
        runs({
          stageKey: "implement",
          outcome: asks,
          decisions: [{ ...open, kind: "agent", answer: { kind: "answered", answer: "One" } }],
        }),
      ),
    ).toEqual(["done"]);
  });

  it("tells a skipped optional Stage from a done one", () => {
    const skipped: StageOutcome = { status: "done", summary: "Skipped: met.", skipped: true };

    expect(
      statesOf(
        [implement, review],
        runs({ stageKey: "implement", outcome: done }, { stageKey: "review", outcome: skipped }),
      ),
    ).toEqual(["done", "skipped"]);
  });

  it("counts every run's tokens as budgets do, without cache reads", () => {
    const tokens = { input: 10, output: 200, cacheRead: 30_000, cacheCreation: 4_000 };
    const progress = stagesProgress(
      [implement, tests],
      runs(
        { stageKey: "implement", outcome: done, tokens },
        { stageKey: "tests", outcome: failed },
        { stageKey: "implement", outcome: done, tokens },
      ),
    );

    expect(progress.map((each) => each.tokens)).toEqual([8_420, 0]);
  });
});
