import type { Stage, StageRun, TaskStage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { NO_TOKENS } from "../../shell/token-words.ts";
import { flowProgressOf, pipelineProgress, roundBound } from "./pipeline-progress.ts";
import { roundWords } from "./stage-rail-words.ts";

const plan: Stage = { kind: "gate", key: "plan", name: "Plan", optional: false };
const implement: Stage = {
  kind: "agent",
  key: "implement",
  name: "Implement",
  optional: false,
  role: "developer",
  brief: "Do it.",
  session: "fresh",
  budget: 250_000,
};
const tests: Stage = {
  kind: "script",
  key: "tests",
  name: "Tests",
  optional: false,
  command: "test",
  routes: [
    {
      to: "implement",
      condition: { combine: "all", tests: [{ kind: "stage", stage: null, is: "failed" }] },
      limit: 3,
    },
    { to: null, condition: null, limit: null },
  ],
};
const review: Stage = { kind: "gate", key: "review", name: "Review", optional: false };
const stages = [implement, tests, review];

function aRun(number: number, fields: Partial<StageRun> = {}): StageRun {
  return {
    id: "8f0b1a52-3c1e-4a4e-9d0e-1f5b6c7d8e9f",
    number,
    startedAt: "2026-10-26T10:00:00.000Z",
    endedAt: "2026-10-26T10:18:00.000Z",
    waitingSince: null,
    threadId: null,
    session: null,
    engine: null,
    engineSwitches: [],
    tokens: NO_TOKENS,
    context: null,
    carriedFailure: null,
    route: null,
    choice: null,
    sentBack: null,
    restart: null,
    restarted: null,
    startedOver: null,
    earlierStart: false,
    gateAction: null,
    commandRuns: [],
    outcome: null,
    ...fields,
  };
}

function aTaskStage(stage: Stage, state: TaskStage["state"], runs: StageRun[] = []): TaskStage {
  return { stage, state, tokens: NO_TOKENS, wentBack: null, runs };
}

const keysOf = (progress: ReturnType<typeof pipelineProgress>): string[] =>
  progress.stages.map(({ taskStage }) => taskStage.stage.key);

describe("pipelineProgress", () => {
  it("lists every Stage in Pipeline order before any run, with nothing current", () => {
    const progress = pipelineProgress(
      stages.map((stage) => aTaskStage(stage, "pending")),
      "planning",
    );
    expect(keysOf(progress)).toEqual(["implement", "tests", "review"]);
    expect(progress.currentKey).toBeNull();
    expect(progress.started).toBe(false);
    expect(progress.walk).toEqual([]);
  });

  it("follows a straight walk and stops at the latest run's Stage", () => {
    const progress = pipelineProgress(
      [
        aTaskStage(implement, "done", [aRun(1, { route: { to: "tests", times: 1, limit: null } })]),
        aTaskStage(tests, "running", [aRun(2, { endedAt: null })]),
        aTaskStage(review, "pending"),
      ],
      "in-progress",
    );
    expect(progress.currentKey).toBe("tests");
    expect(progress.taken.get("implement")).toEqual([{ to: "tests", times: 1, limit: null }]);
    expect(progress.walk.map(({ went }) => went?.kind ?? null)).toEqual(["on", null]);
  });

  it("shows a Stage the work came back to once, counting its rounds", () => {
    const back = { to: "implement", times: 1, limit: 3 } as const;
    const progress = pipelineProgress(
      [
        aTaskStage(implement, "running", [
          aRun(1, { route: { to: "tests", times: 1, limit: null } }),
          aRun(3, { endedAt: null }),
        ]),
        aTaskStage(tests, "done", [aRun(2, { route: back })]),
        aTaskStage(review, "pending"),
      ],
      "in-progress",
    );
    expect(keysOf(progress)).toEqual(["implement", "tests", "review"]);
    const [first] = progress.stages;
    expect(first?.rounds).toBe(2);
    expect(first?.roundBound).toBe(4);
    expect(roundWords(first!)).toBe("Round 2 of ≤4");
    expect(progress.walk.map(({ round }) => round)).toEqual([1, 1, 2]);
    expect(progress.walk[1]?.went).toMatchObject({ kind: "back", to: "implement" });
    expect(progress.currentKey).toBe("implement");
  });

  it("counts a run resumed after a Decision as the same round", () => {
    const progress = pipelineProgress(
      [aTaskStage(implement, "running", [aRun(1), aRun(2, { endedAt: null })])],
      "in-progress",
    );
    expect(progress.stages[0]?.rounds).toBe(1);
  });

  it("orders Stages by first run, then those not reached in Pipeline order", () => {
    const progress = pipelineProgress(
      [
        aTaskStage(plan, "pending"),
        aTaskStage(implement, "done", [
          aRun(1, { route: { to: "review", times: 1, limit: null } }),
        ]),
        aTaskStage(review, "waiting-on-you", [aRun(2, { endedAt: null })]),
        aTaskStage(tests, "not-taken"),
      ],
      "in-progress",
    );
    expect(keysOf(progress)).toEqual(["implement", "review", "plan", "tests"]);
    expect(progress.stages.map(({ reached }) => reached)).toEqual([true, true, false, false]);
  });

  it("puts Stages a Restart from… jumped over right after the Stage that left them", () => {
    const progress = pipelineProgress(
      [
        aTaskStage(plan, "done", [
          aRun(1, { restart: { stageKey: "review", feedback: null, by: "Ada" } }),
        ]),
        aTaskStage(implement, "skipped"),
        aTaskStage(tests, "skipped"),
        aTaskStage(review, "running", [aRun(2, { endedAt: null })]),
      ],
      "in-progress",
    );
    expect(keysOf(progress)).toEqual(["plan", "implement", "tests", "review"]);
    expect(progress.stages.map(({ reached }) => reached)).toEqual([true, true, true, true]);
    expect(progress.walk[0]?.went).toEqual({ kind: "restart", to: "review" });
    expect(progress.walk.map(({ stageKey }) => stageKey)).toEqual(["plan", "review"]);
  });

  it("leaves runs of an earlier start out, as after Start over", () => {
    const progress = pipelineProgress(
      [
        aTaskStage(implement, "pending", [aRun(1, { earlierStart: true })]),
        aTaskStage(tests, "pending", [aRun(2, { earlierStart: true })]),
      ],
      "in-progress",
    );
    expect(progress.started).toBe(false);
    expect(progress.walk).toEqual([]);
    expect(progress.stages.every(({ reached }) => !reached)).toBe(true);
    expect(progress.startedOver).toBeNull();
  });

  it("says who started over last and how many runs the earlier starts left", () => {
    const by = { by: "Ann Lee", at: "2026-10-26T11:00:00.000Z", resetTo: null, keptRef: null };
    const progress = pipelineProgress(
      [
        aTaskStage(implement, "running", [aRun(1, { earlierStart: true }), aRun(3)]),
        aTaskStage(tests, "pending", [aRun(2, { earlierStart: true, startedOver: by })]),
      ],
      "in-progress",
    );
    expect(progress.startedOver).toEqual({ by, earlierRuns: 2 });
    expect(progress.walk.map(({ run }) => run.number)).toEqual([3]);
  });

  it("marks the end route taken and has no current Stage once Done", () => {
    const progress = pipelineProgress(
      [aTaskStage(tests, "done", [aRun(1, { route: { to: null, times: 1, limit: null } })])],
      "done",
    );
    expect(progress.currentKey).toBeNull();
    expect(progress.taken.get("tests")).toEqual([{ to: null, times: 1, limit: null }]);
    expect(progress.walk[0]?.went).toMatchObject({ kind: "end" });
  });

  it("is at the Stage holding the walk when no run says so", () => {
    const progress = pipelineProgress(
      [aTaskStage(implement, "done"), aTaskStage(tests, "paused")],
      "in-progress",
    );
    expect(progress.currentKey).toBe("tests");
  });
});

describe("roundBound", () => {
  const flow = stages.map((stage) => aTaskStage(stage, "pending"));

  it("is the first round plus the limits of the routes back spanning the Stage", () => {
    expect(roundBound(flow, "implement", 1)).toBe(4);
    expect(roundBound(flow, "tests", 2)).toBe(4);
  });

  it("is null for a Stage no route back spans", () => {
    expect(roundBound(flow, "review", 1)).toBeNull();
  });

  it("is null once the rounds pass it", () => {
    expect(roundBound(flow, "implement", 5)).toBeNull();
  });
});

describe("flowProgressOf", () => {
  it("names the Stages that ran and those left quiet", () => {
    const progress = flowProgressOf(
      pipelineProgress(
        [
          aTaskStage(implement, "done", [aRun(1)]),
          aTaskStage(tests, "not-taken"),
          aTaskStage(review, "pending"),
        ],
        "in-progress",
      ),
    );
    expect(progress.ran).toEqual(new Set(["implement"]));
    expect(progress.quiet).toEqual(new Set(["tests"]));
    expect(progress.current).toBe("implement");
    expect(progress.started).toBe(true);
  });
});

describe("roundWords", () => {
  it("says nothing for the first round", () => {
    expect(roundWords({ rounds: 1, roundBound: 3 })).toBe("");
  });

  it("drops the bound when none holds", () => {
    expect(roundWords({ rounds: 3, roundBound: null })).toBe("Round 3");
  });

  it("spells the bound out for a screen reader", () => {
    expect(roundWords({ rounds: 2, roundBound: 3 }, true)).toBe("Round 2 of at most 3");
  });
});
