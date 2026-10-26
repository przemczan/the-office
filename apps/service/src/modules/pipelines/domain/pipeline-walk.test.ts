import { describe, expect, it } from "vitest";
import { nextMove, unmetStatements } from "./pipeline-walk.js";
import type { OnFailure, Stage } from "./stage.js";
import {
  NO_STAGE_TOKENS,
  type StageDecisionKind,
  type StageOutcome,
  type StageRun,
  type StageRunDecision,
  type WalkAnswer,
} from "./stage-run.js";

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

/** No statements, so no run needs to report any met. */
const NO_DEFINITION_OF_DONE: readonly string[] = [];
const DEFINITION_OF_DONE = ["The name shows", "The name persists"];

const done: StageOutcome = { status: "done", summary: "Done." };
const meeting = (...met: number[]): StageOutcome => ({
  status: "done",
  summary: "Done.",
  definitionOfDoneMet: met,
});
const failed = (error: string): StageOutcome => ({ status: "failed", error });
const asks: StageOutcome = {
  status: "needs-decision",
  question: "Which page?",
  context: "Both list devices.",
  options: ["The device page", "The list"],
  recommendation: { option: 0, reason: "It has the room." },
};

type Ran = readonly [string, StageOutcome | undefined, ...StageRunDecision[]];

/** The Task's runs of these Stages, in order; an undefined outcome is still running. */
function runs(...ran: readonly Ran[]): StageRun[] {
  return ran.map(([stageKey, outcome, ...decisions], index) => ({
    id: `run-${index + 1}`,
    taskId: "task-1",
    stageKey,
    number: index + 1,
    carriedFailure: undefined,
    threadId: undefined,
    session: undefined,
    headCommit: undefined,
    commandRuns: [],
    tokens: NO_STAGE_TOKENS,
    decisions,
    heldBy: undefined,
    outcome,
    startedAt: new Date(0),
    endedAt: outcome && new Date(0),
  }));
}

/**
 * A Decision kept on the run, answered `answer` (undefined: still open): the Agent's own, which it
 * opened with an Office tool, or one the walk opened.
 */
function decided(kind: StageDecisionKind, answer?: WalkAnswer): StageRunDecision {
  const id = `decision-${kind}`;
  return kind === "agent"
    ? { id, kind, question: "Which page?", options: [], answer }
    : { id, kind, options: [], answer };
}

const stages = [
  agentStage("write"),
  scriptStage("check", { goBackTo: "write", rounds: 2 }),
  agentStage("look", { goBackTo: "check", rounds: 1 }),
];

/** The check's loop going back twice, as many times as it may, then failing again. */
const checkUsedUp: readonly Ran[] = [
  ["write", done],
  ["check", failed("First.")],
  ["write", done],
  ["check", failed("Second.")],
  ["write", done],
  ["check", failed("Third.")],
];

/** The check's loop used up, with the user's answer to the Decision on its last run. */
function answeredUsedUp(answer: WalkAnswer): StageRun[] {
  const ran = runs(...checkUsedUp);
  const last = ran[5];
  if (!last) throw new Error("The check never failed a third time.");
  ran[5] = { ...last, decisions: [decided("no-retries-left", answer)] };
  return ran;
}

/** Every Stage ran, the first reporting the whole Definition of Done met, the look ending `last`. */
function allRan(last: StageOutcome, ...decisions: StageRunDecision[]): StageRun[] {
  return runs(["write", meeting(1, 2)], ["check", done], ["look", last, ...decisions]);
}

describe("nextMove", () => {
  it("runs the first Stage of a Task that hasn't run any", () => {
    expect(nextMove(stages, [], NO_DEFINITION_OF_DONE)).toEqual({
      move: "run",
      stage: stages[0],
      carriedFailure: undefined,
    });
  });

  it("runs the Stage after one that ended done", () => {
    expect(nextMove(stages, runs(["write", done]), NO_DEFINITION_OF_DONE)).toMatchObject({
      move: "run",
      stage: { key: "check" },
      carriedFailure: undefined,
    });
  });

  it("goes back to the loop's Stage with the error and the round", () => {
    const ran = runs(["write", done], ["check", failed("2 tests fail.")]);

    expect(nextMove(stages, ran, NO_DEFINITION_OF_DONE)).toEqual({
      move: "run",
      stage: stages[0],
      carriedFailure: { stageKey: "check", error: "2 tests fail.", round: 1, rounds: 2 },
    });
  });

  it("runs a stopped Stage again with the failure it carried, using no round and asking nothing", () => {
    const stopped: StageOutcome = { status: "failed", error: "Stopped.", interrupted: "stop" };
    const carried = { stageKey: "check", error: "2 tests fail.", round: 1, rounds: 2 };
    const ran = runs(["write", done], ["check", failed("2 tests fail.")], ["write", stopped]);

    expect(nextMove(stages, ran, NO_DEFINITION_OF_DONE)).toEqual({
      move: "run",
      stage: stages[0],
      carriedFailure: carried,
    });
    const after = runs(
      ["write", done],
      ["check", failed("2 tests fail.")],
      ["write", stopped],
      ["write", done],
      ["check", failed("1 test fails.")],
    );
    expect(nextMove(stages, after, NO_DEFINITION_OF_DONE)).toMatchObject({
      carriedFailure: { round: 2, rounds: 2 },
    });
    expect(nextMove(stages, runs(["write", stopped]), NO_DEFINITION_OF_DONE)).toEqual({
      move: "run",
      stage: stages[0],
      carriedFailure: undefined,
    });
  });

  it("waits on the Decision a held run's Agent opened, then runs the Stage again once answered", () => {
    const answer = { kind: "answered", answer: "The list" } as const;
    for (const interrupted of ["stop", "pause"] as const) {
      const held: StageOutcome = { status: "failed", error: "Held.", interrupted };
      const waiting = runs(["write", held, decided("agent")]);
      const answered = runs(["write", held, decided("agent", answer)]);

      expect(nextMove(stages, waiting, NO_DEFINITION_OF_DONE)).toEqual({
        move: "wait",
        run: waiting[0],
      });
      expect(nextMove(stages, answered, NO_DEFINITION_OF_DONE)).toMatchObject({
        move: "run",
        stage: { key: "write" },
      });
    }
  });

  it("waits on the Agent's Decision before asking to run again a Stage The Office restarted during", () => {
    const restarted: StageOutcome = {
      status: "failed",
      error: "Restarted.",
      interrupted: "restart",
    };
    const waiting = runs(["write", restarted, decided("agent")]);
    const answered = runs([
      "write",
      restarted,
      decided("agent", { kind: "answered", answer: "The list" }),
    ]);

    expect(nextMove(stages, waiting, NO_DEFINITION_OF_DONE)).toMatchObject({ move: "wait" });
    expect(nextMove(stages, answered, NO_DEFINITION_OF_DONE)).toMatchObject({
      move: "ask",
      question: { kind: "restart" },
    });
  });

  it("asks before running again a Stage The Office restarted during, then runs it using no round, or drops the Task", () => {
    const restarted: StageOutcome = {
      status: "failed",
      error: "The Office restarted during this Stage.",
      interrupted: "restart",
    };
    const carried = { stageKey: "check", error: "2 tests fail.", round: 1, rounds: 2 };
    const before: Ran[] = [
      ["write", done],
      ["check", failed("2 tests fail.")],
    ];

    expect(nextMove(stages, runs(...before, ["write", restarted]), NO_DEFINITION_OF_DONE)).toEqual({
      move: "ask",
      run: expect.objectContaining({ id: "run-3" }),
      question: { kind: "restart", stage: stages[0] },
    });
    const waiting = runs(...before, ["write", restarted, decided("restart")]);
    expect(nextMove(stages, waiting, NO_DEFINITION_OF_DONE)).toMatchObject({ move: "wait" });
    const again = decided("restart", { kind: "one-more-round", guidance: "Smaller." });
    expect(
      nextMove(stages, runs(...before, ["write", restarted, again]), NO_DEFINITION_OF_DONE),
    ).toEqual({ move: "run", stage: stages[0], carriedFailure: carried });
    const drop = decided("restart", { kind: "drop" });
    expect(
      nextMove(stages, runs(...before, ["write", restarted, drop]), NO_DEFINITION_OF_DONE),
    ).toEqual({ move: "drop" });
  });

  it("carries the error into the next run only", () => {
    const ran = runs(["write", done], ["check", failed("2 tests fail.")], ["write", done]);

    expect(nextMove(stages, ran, NO_DEFINITION_OF_DONE)).toMatchObject({
      stage: { key: "check" },
      carriedFailure: undefined,
    });
  });

  it("asks the user once a loop has gone back as many times as it may", () => {
    const ran = runs(...checkUsedUp);

    expect(nextMove(stages, ran, NO_DEFINITION_OF_DONE)).toEqual({
      move: "ask",
      run: ran[5],
      question: { kind: "no-retries-left", stage: stages[1], error: "Third." },
    });
  });

  it("counts each loop's rounds apart, over the whole Task", () => {
    const bothLoopsWentBack: Ran[] = [
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

    expect(nextMove(stages, runs(...bothLoopsWentBack), NO_DEFINITION_OF_DONE)).toMatchObject({
      stage: { key: "write" },
      carriedFailure: { stageKey: "check", error: "Second.", round: 2, rounds: 2 },
    });
    expect(nextMove(stages, lookFailsAgain, NO_DEFINITION_OF_DONE)).toMatchObject({
      move: "ask",
      run: { stageKey: "look" },
      question: { kind: "no-retries-left" },
    });
  });

  it("asks the user at a failed Stage that has no loop", () => {
    const ran = runs(["write", failed("The session ended.")]);

    expect(nextMove(stages, ran, NO_DEFINITION_OF_DONE)).toEqual({
      move: "ask",
      run: ran[0],
      question: { kind: "no-retries-left", stage: stages[0], error: "The session ended." },
    });
  });

  it("waits while a run is running, or its Decision waits on the user", () => {
    const running = runs(["write", undefined]);
    const asking = runs(["write", asks, decided("agent")]);
    const noRetries = runs(["write", failed("Gone."), decided("no-retries-left")]);

    expect(nextMove(stages, running, NO_DEFINITION_OF_DONE)).toEqual({
      move: "wait",
      run: running[0],
    });
    expect(nextMove(stages, asking, NO_DEFINITION_OF_DONE)).toEqual({
      move: "wait",
      run: asking[0],
    });
    expect(nextMove(stages, noRetries, NO_DEFINITION_OF_DONE)).toEqual({
      move: "wait",
      run: noRetries[0],
    });
  });

  it("never asks the Agent's question itself: its run keeps the Decision the Agent opened", () => {
    expect(() => nextMove(stages, runs(["write", asks]), NO_DEFINITION_OF_DONE)).toThrow(
      "needs a Decision its Agent didn't keep",
    );
  });

  it("runs the same Stage again once its Decision is answered", () => {
    const answer = { kind: "answered", answer: "The list" } as const;
    const answered = runs(["write", asks, decided("agent", answer)]);
    const ranAgain = runs(["write", asks, decided("agent", answer)], ["write", done]);

    expect(nextMove(stages, answered, NO_DEFINITION_OF_DONE)).toMatchObject({
      move: "run",
      stage: { key: "write" },
      carriedFailure: undefined,
    });
    expect(nextMove(stages, ranAgain, NO_DEFINITION_OF_DONE)).toMatchObject({
      move: "run",
      stage: { key: "check" },
    });
  });

  describe("after a failure with no retries left", () => {
    it("goes back for the rounds the user allowed, counting on from the loop's", () => {
      const ran = answeredUsedUp({ kind: "more-rounds", rounds: 2 });

      expect(nextMove(stages, ran, NO_DEFINITION_OF_DONE)).toEqual({
        move: "run",
        stage: stages[0],
        carriedFailure: { stageKey: "check", error: "Third.", round: 3, rounds: 4 },
      });
    });

    it("goes back once more with the user's guidance", () => {
      const ran = answeredUsedUp({ kind: "one-more-round", guidance: "Mock the clock." });

      expect(nextMove(stages, ran, NO_DEFINITION_OF_DONE)).toMatchObject({
        stage: { key: "write" },
        carriedFailure: { round: 3, rounds: 3, guidance: "Mock the clock." },
      });
    });

    it("runs a Stage without a loop itself again for the round the user gave it", () => {
      const ran = runs([
        "write",
        failed("The session ended."),
        decided("no-retries-left", { kind: "one-more-round", guidance: undefined }),
      ]);

      expect(nextMove(stages, ran, NO_DEFINITION_OF_DONE)).toEqual({
        move: "run",
        stage: stages[0],
        carriedFailure: { stageKey: "write", error: "The session ended.", round: 1, rounds: 1 },
      });
    });

    it("goes on past the failed Stage when the user continues with its issues", () => {
      const ran = answeredUsedUp({ kind: "accept-issues" });

      expect(nextMove(stages, ran, NO_DEFINITION_OF_DONE)).toMatchObject({
        move: "run",
        stage: { key: "look" },
        carriedFailure: undefined,
      });
    });

    it("drops the Task when the user drops it", () => {
      expect(nextMove(stages, answeredUsedUp({ kind: "drop" }), NO_DEFINITION_OF_DONE)).toEqual({
        move: "drop",
      });
    });
  });

  describe("at the end of the Pipeline", () => {
    it("completes when the last report has every statement of the Definition of Done met", () => {
      expect(nextMove(stages, allRan(meeting(1, 2)), DEFINITION_OF_DONE)).toEqual({
        move: "complete",
      });
    });

    it("asks the user when the last report leaves a statement unmet", () => {
      const ran = allRan(meeting(2));

      expect(nextMove(stages, ran, DEFINITION_OF_DONE)).toEqual({
        move: "ask",
        run: ran[2],
        question: { kind: "definition-of-done", unmet: ["The name shows"], again: stages[2] },
      });
    });

    it("completes when the user marks the Task Done anyway", () => {
      const ran = allRan(meeting(2), decided("definition-of-done", { kind: "mark-done" }));

      expect(nextMove(stages, ran, DEFINITION_OF_DONE)).toEqual({ move: "complete" });
    });

    it("runs the last Agent Stage once more with what is left and the user's guidance", () => {
      const answer = { kind: "one-more-round", guidance: "Show it bold." } as const;
      const ran = allRan(meeting(2), decided("definition-of-done", answer));

      expect(nextMove(stages, ran, DEFINITION_OF_DONE)).toEqual({
        move: "run",
        stage: stages[2],
        carriedFailure: {
          stageKey: "look",
          error: "The Definition of Done isn't reported met:\n- The name shows",
          round: 1,
          rounds: 1,
          guidance: "Show it bold.",
        },
      });
    });

    it("checks it after issues the user continued with at the last Stage too", () => {
      const accepted = decided("no-retries-left", { kind: "accept-issues" });
      const metEarlier = allRan(failed("A finding."), accepted);
      const ran = runs(["write", meeting(1)], ["check", done], ["look", failed("A finding.")]);
      const last = ran[2];
      if (!last) throw new Error("The look never ran.");
      ran[2] = { ...last, decisions: [accepted] };

      // Without a loop of its own, the look fails with no retries left at once.
      const lookLast = [agentStage("write"), scriptStage("check"), agentStage("look")];

      expect(nextMove(lookLast, metEarlier, DEFINITION_OF_DONE)).toEqual({ move: "complete" });
      expect(nextMove(lookLast, ran, DEFINITION_OF_DONE)).toMatchObject({
        move: "ask",
        run: { stageKey: "look" },
        question: { kind: "definition-of-done", unmet: ["The name persists"] },
      });
    });
  });

  describe("an optional Stage", () => {
    const withOptional = [agentStage("write"), { ...agentStage("look"), optional: true }];

    it("is skipped once every statement of the Definition of Done is reported met", () => {
      expect(nextMove(withOptional, runs(["write", meeting(1, 2)]), DEFINITION_OF_DONE)).toEqual({
        move: "skip",
        stage: withOptional[1],
      });
    });

    it("runs while a statement isn't reported met", () => {
      expect(nextMove(withOptional, runs(["write", meeting(1)]), DEFINITION_OF_DONE)).toMatchObject(
        { move: "run", stage: { key: "look" } },
      );
    });
  });

  describe("a budget reached", () => {
    const reached = { used: 120_000, budget: 100_000 };
    const overBudget: StageOutcome = { status: "failed", error: "Over.", budgetReached: reached };

    it("asks the user, never going back through the Stage's loop", () => {
      const ran = runs(["write", done], ["check", done], ["look", overBudget]);

      expect(nextMove(stages, ran, NO_DEFINITION_OF_DONE)).toEqual({
        move: "ask",
        run: ran[2],
        question: { kind: "budget", stage: stages[2], reached },
      });
    });

    it("runs the Stage again once the user raises it, or drops the Task", () => {
      const raised = runs([
        "write",
        overBudget,
        decided("budget", { kind: "raise-budget", tokens: 120_000 }),
      ]);
      const dropped = runs(["write", overBudget, decided("budget", { kind: "drop" })]);

      expect(nextMove(stages, raised, NO_DEFINITION_OF_DONE)).toEqual({
        move: "run",
        stage: stages[0],
        carriedFailure: undefined,
      });
      expect(nextMove(stages, dropped, NO_DEFINITION_OF_DONE)).toEqual({ move: "drop" });
    });
  });

  it("refuses runs that don't follow the Task's Stages", () => {
    expect(() => nextMove(stages, runs(["check", done]), NO_DEFINITION_OF_DONE)).toThrow(
      /expected "write"/,
    );
  });

  it("refuses runs after one whose Decision is still open", () => {
    const ran = runs(["write", asks, decided("agent")], ["write", done]);

    expect(() => nextMove(stages, ran, NO_DEFINITION_OF_DONE)).toThrow(/yet runs follow it/);
  });
});

describe("unmetStatements", () => {
  it("goes by the last report, which a Script Stage never gives", () => {
    const ran = runs(["write", meeting(1)], ["look", meeting(1, 2)], ["check", done]);

    expect(unmetStatements(DEFINITION_OF_DONE, ran)).toEqual([]);
    expect(unmetStatements(DEFINITION_OF_DONE, ran.slice(0, 1))).toEqual(["The name persists"]);
    expect(unmetStatements(DEFINITION_OF_DONE, [])).toEqual(DEFINITION_OF_DONE);
  });
});
