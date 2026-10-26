import { describe, expect, it } from "vitest";
import { nextMove } from "./pipeline-walk.js";
import type { OnFailure, Stage } from "./stage.js";
import type { StageOutcome, StageRun } from "./stage-run.js";

function agentStage(key: string, onFailure?: OnFailure): Stage {
  return {
    kind: "agent",
    key,
    name: key,
    optional: false,
    role: "developer",
    brief: `Do ${key}.`,
    session: "fresh",
    budget: 100_000,
    ...(onFailure && { onFailure }),
  };
}

function scriptStage(key: string, onFailure?: OnFailure): Stage {
  return {
    kind: "script",
    key,
    name: key,
    optional: false,
    command: "test",
    ...(onFailure && { onFailure }),
  };
}

const done: StageOutcome = { status: "done", summary: "Done." };
const failed = (error: string): StageOutcome => ({ status: "failed", error });

/** The Task's runs of these Stages, in order; an undefined outcome is still running. */
function runs(...ran: readonly [string, StageOutcome | undefined][]): StageRun[] {
  return ran.map(([stageKey, outcome], index) => ({
    id: `run-${index + 1}`,
    taskId: "task-1",
    stageKey,
    number: index + 1,
    carriedFailure: undefined,
    outcome,
    startedAt: new Date(0),
    endedAt: outcome && new Date(0),
  }));
}

const stages = [
  agentStage("write"),
  scriptStage("check", { goBackTo: "write", rounds: 2 }),
  agentStage("look", { goBackTo: "check", rounds: 1 }),
];

describe("nextMove", () => {
  it("runs the first Stage of a Task that hasn't run any", () => {
    expect(nextMove(stages, [])).toEqual({
      move: "run",
      stage: stages[0],
      carriedFailure: undefined,
    });
  });

  it("runs the Stage after one that ended done", () => {
    expect(nextMove(stages, runs(["write", done]))).toMatchObject({
      move: "run",
      stage: { key: "check" },
      carriedFailure: undefined,
    });
  });

  it("goes back to the loop's Stage with the error and the round", () => {
    expect(nextMove(stages, runs(["write", done], ["check", failed("2 tests fail.")]))).toEqual({
      move: "run",
      stage: stages[0],
      carriedFailure: { stageKey: "check", error: "2 tests fail.", round: 1, rounds: 2 },
    });
  });

  it("carries the error into the next run only", () => {
    const ran = runs(["write", done], ["check", failed("2 tests fail.")], ["write", done]);

    expect(nextMove(stages, ran)).toMatchObject({
      stage: { key: "check" },
      carriedFailure: undefined,
    });
  });

  it("stops once a loop has gone back as many times as it may", () => {
    const ran = runs(
      ["write", done],
      ["check", failed("First.")],
      ["write", done],
      ["check", failed("Second.")],
      ["write", done],
      ["check", failed("Third.")],
    );

    expect(nextMove(stages, ran)).toEqual({ move: "stop", run: ran[5], error: "Third." });
  });

  it("counts each loop's rounds apart, over the whole Task", () => {
    const bothLoopsWentBack: [string, StageOutcome][] = [
      ["write", done],
      ["check", failed("First.")],
      ["write", done],
      ["check", done],
      ["look", failed("A finding.")],
      ["check", failed("Second.")],
    ];
    const lookFailsAgain = runs(
      ...bothLoopsWentBack,
      ["write", done],
      ["check", done],
      ["look", failed("Another.")],
    );

    expect(nextMove(stages, runs(...bothLoopsWentBack))).toMatchObject({
      stage: { key: "write" },
      carriedFailure: { stageKey: "check", error: "Second.", round: 2, rounds: 2 },
    });
    expect(nextMove(stages, lookFailsAgain)).toMatchObject({
      move: "stop",
      run: { stageKey: "look" },
    });
  });

  it("stops at a failed Stage that has no loop", () => {
    const ran = runs(["write", failed("The session ended.")]);

    expect(nextMove(stages, ran)).toEqual({
      move: "stop",
      run: ran[0],
      error: "The session ended.",
    });
  });

  it("waits while a run is running or needs a Decision", () => {
    const running = runs(["write", undefined]);
    const asking = runs(["write", { status: "needs-decision", question: "Which page?" }]);

    expect(nextMove(stages, running)).toEqual({ move: "wait", run: running[0] });
    expect(nextMove(stages, asking)).toEqual({ move: "wait", run: asking[0] });
  });

  it("runs the same Stage again once its Decision is answered", () => {
    const ran = runs(
      ["write", { status: "needs-decision", question: "Which page?" }],
      ["write", done],
    );

    expect(nextMove(stages, ran)).toMatchObject({ move: "run", stage: { key: "check" } });
  });

  it("completes when every Stage ended done", () => {
    expect(nextMove(stages, runs(["write", done], ["check", done], ["look", done]))).toEqual({
      move: "complete",
    });
  });

  it("refuses runs that don't follow the Task's Stages", () => {
    expect(() => nextMove(stages, runs(["check", done]))).toThrow(/expected "write"/);
  });
});
