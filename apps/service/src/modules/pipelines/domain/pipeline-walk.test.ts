import { describe, expect, it } from "vitest";
import { GATE_REACHED } from "./gate.js";
import { nextMove, reportedMet, reportedOutOfReach, unmetStatements } from "./pipeline-walk.js";
import {
  RESOLVE_GATE_KEY,
  RESOLVE_KEY,
  RESOLVE_TEST_KEY,
  resolvedByTheUser,
  walkedStages,
} from "./resolve-stages.js";
import type { OnFailure, Stage } from "./stage.js";
import {
  NO_STAGE_TOKENS,
  type GateAction,
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
/** A report meeting `met`, with `outOfReach` out of reach. */
const outOfReach = (met: number[], ...statements: number[]): StageOutcome => ({
  status: "done",
  summary: "Done.",
  definitionOfDoneMet: met,
  definitionOfDoneOutOfReach: statements.map((statement) => ({ statement, why: "Live." })),
});
const failed = (error: string): StageOutcome => ({ status: "failed", error });
const restarted: StageOutcome = {
  status: "failed",
  error: "The Office restarted during this Stage.",
  interrupted: "restart",
};
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
    roleKey: undefined,
    session: undefined,
    headCommit: undefined,
    commandRuns: [],
    tokens: NO_STAGE_TOKENS,
    context: undefined,
    engineId: undefined,
    engineName: undefined,
    model: undefined,
    decisions,
    heldBy: undefined,
    heldByUser: undefined,
    published: undefined,
    waitingSince: undefined,
    sentBack: undefined,
    gateAction: undefined,
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

/** The runs with the user's Continue on the Gate's run, the `fromLast`th from the end. */
function continuedAtTheGate(ran: readonly StageRun[], fromLast = 1): StageRun[] {
  const gateIndex = ran.length - fromLast;
  return ran.map((run, index) =>
    index === gateIndex ? { ...run, gateAction: { kind: "continue" } } : run,
  );
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

/** Every Stage ran, the first reporting nothing met, the look ending `last`. */
function allRan(last: StageOutcome, ...decisions: StageRunDecision[]): StageRun[] {
  return runs(["write", meeting()], ["check", done], ["look", last, ...decisions]);
}

/** A report meeting `met` that takes back `noLongerMet`. */
const takingBack = (met: number[], ...noLongerMet: number[]): StageOutcome => ({
  status: "done",
  summary: "Done.",
  definitionOfDoneMet: met,
  definitionOfDoneNoLongerMet: noLongerMet,
});

/** The Stages before Publish ran, the write meeting the first statement, the review ending `review`. */
function reviewed(review: StageOutcome, ...decisions: StageRunDecision[]): readonly Ran[] {
  return [
    ["write", meeting(1)],
    ["check", done],
    ["review", review, ...decisions],
  ];
}

/** Every Stage ran through Publish, as before the check moved before it, Publish carrying `decisions`. */
function publishedUnchecked(...decisions: StageRunDecision[]): StageRun[] {
  return runs(
    ["write", meeting(1)],
    ["check", done],
    ["review", meeting()],
    ["publish", done, ...decisions],
  );
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

  it("waits on the Agent's Decision of a Stage The Office restarted during, then runs it again", () => {
    const waiting = runs(["write", restarted, decided("agent")]);
    const answered = runs([
      "write",
      restarted,
      decided("agent", { kind: "answered", answer: "The list" }),
    ]);

    expect(nextMove(stages, waiting, NO_DEFINITION_OF_DONE)).toMatchObject({ move: "wait" });
    expect(nextMove(stages, answered, NO_DEFINITION_OF_DONE)).toMatchObject({
      move: "run",
      stage: { key: "write" },
    });
  });

  it("runs a Stage The Office restarted during again by itself, using no round, with the failure it carried", () => {
    const carried = { stageKey: "check", error: "2 tests fail.", round: 1, rounds: 2 };
    const before: Ran[] = [
      ["write", done],
      ["check", failed("2 tests fail.")],
    ];

    expect(
      nextMove(
        stages,
        runs(...before, ["write", restarted], ["write", restarted]),
        NO_DEFINITION_OF_DONE,
      ),
    ).toEqual({ move: "run", stage: stages[0], carriedFailure: carried });
  });

  it("asks at the third restart in a row during the Stage, then runs it using no round, or drops the Task", () => {
    const carried = { stageKey: "check", error: "2 tests fail.", round: 1, rounds: 2 };
    const before: Ran[] = [
      ["write", done],
      ["check", failed("2 tests fail.")],
      ["write", restarted],
      ["write", restarted],
    ];

    expect(nextMove(stages, runs(...before, ["write", restarted]), NO_DEFINITION_OF_DONE)).toEqual({
      move: "ask",
      run: expect.objectContaining({ id: "run-5" }),
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

  it("counts restarts in a row only since the Stage last got past one, or the user answered one", () => {
    const paused: StageOutcome = { status: "failed", error: "Paused.", interrupted: "pause" };
    const answered = decided("restart", { kind: "one-more-round", guidance: undefined });

    expect(
      nextMove(
        stages,
        runs(["write", restarted], ["write", restarted], ["write", paused], ["write", restarted]),
        NO_DEFINITION_OF_DONE,
      ),
    ).toMatchObject({ move: "run" });
    expect(
      nextMove(
        stages,
        runs(
          ["write", restarted],
          ["write", restarted],
          ["write", restarted, answered],
          ["write", restarted],
          ["write", restarted],
        ),
        NO_DEFINITION_OF_DONE,
      ),
    ).toMatchObject({ move: "run" });
    expect(
      nextMove(
        stages,
        runs(
          ["write", restarted, answered],
          ["write", restarted],
          ["write", restarted],
          ["write", restarted],
        ),
        NO_DEFINITION_OF_DONE,
      ),
    ).toMatchObject({ move: "ask", question: { kind: "restart" } });
  });

  it("asks of a conflict at Publish asked about before Resolve, or with no Agent Stage to resolve it, then runs it again, continues or drops", () => {
    const publishing = [
      agentStage("write"),
      { ...scriptStage("publish", { goBackTo: "write", rounds: 2 }), command: "publish" } as const,
      agentStage("after"),
    ];
    const error = "office/task-1 no longer applies cleanly on main on origin.";
    const moved: StageOutcome = {
      status: "failed",
      error,
      baseMoved: { conflictedFiles: ["a.ts"] },
    };
    const before: Ran = ["write", done];

    const scriptsOnly = [scriptStage("check"), ...publishing.slice(1, 2)];
    expect(
      nextMove(scriptsOnly, runs(["check", done], ["publish", moved]), NO_DEFINITION_OF_DONE),
    ).toEqual({
      move: "ask",
      run: expect.objectContaining({ id: "run-2" }),
      question: { kind: "base-moved", stage: publishing[1], error },
    });
    const waiting = runs(before, ["publish", moved, decided("base-moved")]);
    expect(nextMove(publishing, waiting, NO_DEFINITION_OF_DONE)).toMatchObject({ move: "wait" });
    const again = decided("base-moved", { kind: "one-more-round", guidance: undefined });
    expect(
      nextMove(publishing, runs(before, ["publish", moved, again]), NO_DEFINITION_OF_DONE),
    ).toEqual({
      move: "run",
      stage: publishing[1],
      carriedFailure: undefined,
      sentBack: undefined,
    });
    const accepted = decided("base-moved", { kind: "accept-issues" });
    expect(
      nextMove(publishing, runs(before, ["publish", moved, accepted]), NO_DEFINITION_OF_DONE),
    ).toMatchObject({ move: "run", stage: publishing[2] });
    const drop = decided("base-moved", { kind: "drop" });
    expect(
      nextMove(publishing, runs(before, ["publish", moved, drop]), NO_DEFINITION_OF_DONE),
    ).toEqual({ move: "drop" });
  });

  describe("a branch moved outside The Office", () => {
    const moving = [agentStage("write"), agentStage("after")];
    const error = "The Task's worktree isn't where The Office left it.";
    const moved: StageOutcome = { status: "failed", error, branchMoved: true };

    it("asks, and uses no round whatever the answer", () => {
      expect(nextMove(moving, runs(["write", moved]), NO_DEFINITION_OF_DONE)).toEqual({
        move: "ask",
        run: expect.objectContaining({ id: "run-1" }),
        question: { kind: "branch-moved", stage: moving[0], error },
      });
      const waiting = runs(["write", moved, decided("branch-moved")]);
      expect(nextMove(moving, waiting, NO_DEFINITION_OF_DONE)).toMatchObject({ move: "wait" });
    });

    it.each([
      { kind: "keep-branch", guidance: undefined },
      { kind: "one-more-round", guidance: undefined },
    ] as const)("runs the same Stage again after $kind", (answer) => {
      const answered = runs(["write", moved, decided("branch-moved", answer)]);
      expect(nextMove(moving, answered, NO_DEFINITION_OF_DONE)).toEqual({
        move: "run",
        stage: moving[0],
        carriedFailure: undefined,
        sentBack: undefined,
      });
    });

    it("carries the user's words into the Stage's next run", () => {
      const answer = { kind: "keep-branch", guidance: "Read the new menu first." } as const;
      const answered = runs(["write", moved, decided("branch-moved", answer)]);
      expect(nextMove(moving, answered, NO_DEFINITION_OF_DONE)).toMatchObject({
        move: "run",
        stage: moving[0],
        carriedFailure: { guidance: "Read the new menu first." },
      });
    });

    it("drops the Task when the user says so", () => {
      const answered = runs(["write", moved, decided("branch-moved", { kind: "drop" })]);
      expect(nextMove(moving, answered, NO_DEFINITION_OF_DONE)).toEqual({ move: "drop" });
    });
  });

  describe("a conflict at Publish", () => {
    const publish = {
      ...scriptStage("publish"),
      command: "publish",
      afterConflict: "review",
    } as const;
    const pipeline = [agentStage("write"), scriptStage("check"), publish];
    const error = "office/task-1 no longer applies cleanly on main on origin.";
    const conflicted: StageOutcome = {
      status: "failed",
      error,
      baseMoved: { conflictedFiles: ["a.ts"] },
    };
    const before: readonly Ran[] = [
      ["write", done],
      ["check", done],
    ];
    const resolvedOnce: readonly Ran[] = [
      ...before,
      ["publish", conflicted],
      [RESOLVE_KEY, done],
      [RESOLVE_TEST_KEY, done],
      [RESOLVE_GATE_KEY, done],
    ];

    it("puts Resolve, the Project's Test and a Gate before the Publish, and goes to Resolve", () => {
      const ran = runs(...before, ["publish", conflicted]);

      const walked = walkedStages(pipeline, ran);

      expect(walked.map(({ key }) => key)).toEqual([
        "write",
        "check",
        RESOLVE_KEY,
        RESOLVE_TEST_KEY,
        RESOLVE_GATE_KEY,
        "publish",
      ]);
      expect(walked[2]).toMatchObject({ kind: "agent", role: "developer", session: "fresh" });
      expect(walked[3]).toMatchObject({
        kind: "script",
        command: "test",
        onFailure: { goBackTo: RESOLVE_KEY, rounds: 2 },
      });
      expect(walked[4]).toMatchObject({ kind: "gate" });
      expect(nextMove(pipeline, ran, NO_DEFINITION_OF_DONE)).toEqual({
        move: "run",
        stage: walked[2],
        carriedFailure: { stageKey: "publish", error, round: 1, rounds: 3 },
        sentBack: undefined,
      });
    });

    it("publishes automatically after the Test when the Publish asks for no review", () => {
      const automatic = { ...scriptStage("publish"), command: "publish" } as const;
      const automaticPipeline = [agentStage("write"), scriptStage("check"), automatic];
      const conflictedRuns: readonly Ran[] = [...before, ["publish", conflicted]];

      const walked = walkedStages(automaticPipeline, runs(...conflictedRuns));

      expect(walked.map(({ key }) => key)).toEqual([
        "write",
        "check",
        RESOLVE_KEY,
        RESOLVE_TEST_KEY,
        "publish",
      ]);
      const tested = runs(...conflictedRuns, [RESOLVE_KEY, done], [RESOLVE_TEST_KEY, done]);
      expect(nextMove(automaticPipeline, tested, NO_DEFINITION_OF_DONE)).toMatchObject({
        move: "run",
        stage: automatic,
      });
      const published = runs(
        ...conflictedRuns,
        [RESOLVE_KEY, done],
        [RESOLVE_TEST_KEY, done],
        ["publish", done],
      );
      expect(nextMove(automaticPipeline, published, NO_DEFINITION_OF_DONE)).toEqual({
        move: "complete",
      });
    });

    it("walks the Test, then waits at the Gate, then runs Publish again", () => {
      const tested = runs(...resolvedOnce.slice(0, -1));
      expect(nextMove(pipeline, tested, NO_DEFINITION_OF_DONE)).toMatchObject({
        move: "run",
        stage: { key: RESOLVE_GATE_KEY },
      });
      const atGate = runs(...resolvedOnce.slice(0, -1), [RESOLVE_GATE_KEY, GATE_REACHED]);
      expect(nextMove(pipeline, atGate, NO_DEFINITION_OF_DONE)).toMatchObject({ move: "wait" });
      const continued = continuedAtTheGate(runs(...resolvedOnce));
      expect(nextMove(pipeline, continued, NO_DEFINITION_OF_DONE)).toMatchObject({
        move: "run",
        stage: publish,
      });
      const published = continuedAtTheGate(runs(...resolvedOnce, ["publish", done]), 2);
      expect(nextMove(pipeline, published, NO_DEFINITION_OF_DONE)).toEqual({ move: "complete" });
    });

    it("gives Resolve the duty the first Agent Stage names, and no Role", () => {
      const write: Stage = {
        kind: "agent",
        key: "write",
        name: "write",
        optional: false,
        duty: "implements",
        brief: "Do write.",
        session: "fresh",
        budget: 100_000,
      };
      const naming = [write, scriptStage("check"), publish];

      const resolve = walkedStages(naming, runs(...before, ["publish", conflicted]))[2];

      expect(resolve).toMatchObject({ key: RESOLVE_KEY, duty: "implements" });
      expect(resolve).not.toHaveProperty("role");
    });

    it("goes back to Resolve when the Test fails, at most twice", () => {
      const ran = runs(
        ...before,
        ["publish", conflicted],
        [RESOLVE_KEY, done],
        [RESOLVE_TEST_KEY, failed("1 test fails.")],
      );

      expect(nextMove(pipeline, ran, NO_DEFINITION_OF_DONE)).toMatchObject({
        move: "run",
        stage: { key: RESOLVE_KEY },
        carriedFailure: { stageKey: RESOLVE_TEST_KEY, round: 1, rounds: 2 },
      });
    });

    it("goes back to Resolve each time the conflict comes back, counting it", () => {
      const ran = continuedAtTheGate(runs(...resolvedOnce, ["publish", conflicted]), 2);

      expect(nextMove(pipeline, ran, NO_DEFINITION_OF_DONE)).toMatchObject({
        move: "run",
        stage: { key: RESOLVE_KEY },
        carriedFailure: { stageKey: "publish", round: 2, rounds: 3 },
      });
    });

    it("asks the user directly when Resolve gives up, then commits what they resolved, guides one more round or drops", () => {
      const gaveUp = failed("These files still hold conflict markers.");
      const asked = runs(...before, ["publish", conflicted], [RESOLVE_KEY, gaveUp]);
      const resolve = walkedStages(pipeline, asked)[2];

      expect(nextMove(pipeline, asked, NO_DEFINITION_OF_DONE)).toEqual({
        move: "ask",
        run: expect.objectContaining({ stageKey: RESOLVE_KEY }),
        question: {
          kind: "base-moved",
          stage: resolve,
          error: gaveUp.status === "failed" ? gaveUp.error : "",
        },
      });
      const resolvedByUser = runs(
        ...before,
        ["publish", conflicted],
        [RESOLVE_KEY, gaveUp, decided("base-moved", { kind: "resolved-in-worktree" })],
      );
      expect(nextMove(pipeline, resolvedByUser, NO_DEFINITION_OF_DONE)).toEqual({
        move: "run",
        stage: resolve,
        carriedFailure: undefined,
        sentBack: undefined,
      });
      expect(resolvedByTheUser(resolvedByUser)).toBe(true);
      const guided = runs(
        ...before,
        ["publish", conflicted],
        [
          RESOLVE_KEY,
          gaveUp,
          decided("base-moved", { kind: "one-more-round", guidance: "Keep both lists." }),
        ],
      );
      expect(nextMove(pipeline, guided, NO_DEFINITION_OF_DONE)).toMatchObject({
        move: "run",
        stage: resolve,
        carriedFailure: { stageKey: RESOLVE_KEY, guidance: "Keep both lists." },
      });
      const dropped = runs(
        ...before,
        ["publish", conflicted],
        [RESOLVE_KEY, gaveUp, decided("base-moved", { kind: "drop" })],
      );
      expect(nextMove(pipeline, dropped, NO_DEFINITION_OF_DONE)).toEqual({ move: "drop" });
    });
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
        question: {
          kind: "definition-of-done",
          unmet: ["The name shows"],
          outOfReach: [],
          again: stages[2],
          before: undefined,
        },
      });
    });

    it("completes when an earlier report met what the last one leaves out", () => {
      const ran = runs(["write", meeting(1)], ["check", done], ["look", meeting(2)]);

      expect(nextMove(stages, ran, DEFINITION_OF_DONE)).toEqual({ move: "complete" });
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

    it("asks with the statements the last report says are out of reach, with why", () => {
      const ran = allRan(outOfReach([2], 1));

      expect(nextMove(stages, ran, DEFINITION_OF_DONE)).toMatchObject({
        move: "ask",
        question: {
          kind: "definition-of-done",
          unmet: ["The name shows"],
          outOfReach: [{ statement: "The name shows", why: "Live." }],
        },
      });
    });

    it("carries only the statements one more round can address, leaving the rest to the user", () => {
      const answer = { kind: "one-more-round", guidance: undefined } as const;
      const ran = allRan(outOfReach([], 2), decided("definition-of-done", answer));

      expect(nextMove(stages, ran, DEFINITION_OF_DONE)).toMatchObject({
        move: "run",
        stage: stages[2],
        carriedFailure: {
          error:
            "The Definition of Done isn't reported met:\n- The name shows\n\nThe user checks these themselves, as you reported you can't verify them where you work:\n- The name persists",
        },
      });
    });

    it("checks it after issues the user continued with at the last Stage too", () => {
      const accepted = decided("no-retries-left", { kind: "accept-issues" });
      const metEarlier = runs(
        ["write", meeting(1, 2)],
        ["check", done],
        ["look", failed("A finding."), accepted],
      );
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

  describe("before Publish", () => {
    const publish = {
      ...scriptStage("publish", { goBackTo: "write", rounds: 1 }),
      command: "publish",
    } as const;
    const publishing = [agentStage("write"), scriptStage("check"), agentStage("review"), publish];

    it("asks on the last run before the walk enters Publish, offering the last Agent Stage again", () => {
      const ran = runs(...reviewed(meeting()));

      expect(nextMove(publishing, ran, DEFINITION_OF_DONE)).toEqual({
        move: "ask",
        run: ran[2],
        question: {
          kind: "definition-of-done",
          unmet: ["The name persists"],
          outOfReach: [],
          again: publishing[2],
          before: publish,
        },
      });
    });

    it("runs Publish when every statement is reported met, and completes after it unchecked", () => {
      const met = runs(["write", meeting(1, 2)], ["check", done], ["review", meeting()]);

      expect(nextMove(publishing, met, DEFINITION_OF_DONE)).toMatchObject({
        move: "run",
        stage: publish,
      });
      const published = [...met, ...runs(["publish", done])];
      expect(nextMove(publishing, published, DEFINITION_OF_DONE)).toEqual({ move: "complete" });
    });

    it("asks again when a later report takes a statement back", () => {
      const ran = runs(["write", meeting(1, 2)], ["check", done], ["review", takingBack([], 2)]);

      expect(nextMove(publishing, ran, DEFINITION_OF_DONE)).toMatchObject({
        move: "ask",
        question: { kind: "definition-of-done", unmet: ["The name persists"] },
      });
    });

    it("publishes once the user calls it met, and completes with no second check", () => {
      const calledMet = decided("definition-of-done", { kind: "mark-done" });
      const ran = runs(...reviewed(meeting(), calledMet));

      expect(nextMove(publishing, ran, DEFINITION_OF_DONE)).toMatchObject({
        move: "run",
        stage: publish,
      });
      const published = runs(...reviewed(meeting(), calledMet), ["publish", done]);
      expect(nextMove(publishing, published, DEFINITION_OF_DONE)).toEqual({ move: "complete" });
    });

    it("doesn't ask again when Publish's loop comes back to it after the user called it met", () => {
      const calledMet = decided("definition-of-done", { kind: "mark-done" });
      const ran = runs(
        ...reviewed(meeting(), calledMet),
        ["publish", failed("The push was refused.")],
        ["write", done],
        ["check", done],
        ["review", meeting()],
      );

      expect(nextMove(publishing, ran, DEFINITION_OF_DONE)).toMatchObject({
        move: "run",
        stage: publish,
      });
    });

    it("runs the last Agent Stage once more, then checks again as the walk next reaches Publish", () => {
      const answer = { kind: "one-more-round", guidance: undefined } as const;
      const once = reviewed(meeting(), decided("definition-of-done", answer));

      expect(nextMove(publishing, runs(...once), DEFINITION_OF_DONE)).toEqual({
        move: "run",
        stage: publishing[2],
        carriedFailure: {
          stageKey: "review",
          error: "The Definition of Done isn't reported met:\n- The name persists",
          round: 1,
          rounds: 1,
        },
        sentBack: undefined,
      });
      const stillUnmet = runs(...once, ["review", meeting()]);
      expect(nextMove(publishing, stillUnmet, DEFINITION_OF_DONE)).toMatchObject({
        move: "ask",
        run: stillUnmet[3],
        question: { kind: "definition-of-done", before: publish },
      });
      const met = runs(...once, ["review", meeting(2)]);
      expect(nextMove(publishing, met, DEFINITION_OF_DONE)).toMatchObject({
        move: "run",
        stage: publish,
      });
    });

    it("runs the Stage just before Publish once more when no Agent Stage comes before it", () => {
      const scripted = [scriptStage("check"), publish];
      const answer = { kind: "one-more-round", guidance: undefined } as const;
      const asked = runs(["check", done]);

      expect(nextMove(scripted, asked, DEFINITION_OF_DONE)).toMatchObject({
        move: "ask",
        question: { again: scripted[0], before: publish },
      });
      const ran = runs(["check", done, decided("definition-of-done", answer)]);
      expect(nextMove(scripted, ran, DEFINITION_OF_DONE)).toMatchObject({
        move: "run",
        stage: scripted[0],
      });
    });

    it("checks a Pipeline whose first Stage is Publish at the end, as nothing runs before it", () => {
      const publishOnly = [publish];
      const ran = runs(["publish", done]);

      expect(nextMove(publishOnly, ran, DEFINITION_OF_DONE)).toMatchObject({
        move: "ask",
        run: ran[0],
        question: { kind: "definition-of-done", again: publish, before: undefined },
      });
    });

    it("still checks a Publish-first Pipeline at the end after Resolve's Stages went before it", () => {
      const publishFirst = [
        { ...scriptStage("publish"), command: "publish", afterConflict: "review" } as const,
        agentStage("notes"),
      ];
      const conflicted: StageOutcome = {
        status: "failed",
        error: "office/task-1 no longer applies cleanly on main on origin.",
        baseMoved: { conflictedFiles: ["a.ts"] },
      };
      const ran = continuedAtTheGate(
        runs(
          ["publish", conflicted],
          [RESOLVE_KEY, done],
          [RESOLVE_TEST_KEY, done],
          [RESOLVE_GATE_KEY, done],
          ["publish", done],
          ["notes", meeting(1)],
        ),
        3,
      );

      expect(nextMove(publishFirst, ran, DEFINITION_OF_DONE)).toMatchObject({
        move: "ask",
        run: ran.at(-1),
        question: { kind: "definition-of-done", unmet: ["The name persists"], before: undefined },
      });
    });

    it("keeps waiting on a Decision already open before Publish when nothing is unmet now", () => {
      const ran = runs(...reviewed(meeting(1, 2), decided("definition-of-done")));

      expect(nextMove(publishing, ran, DEFINITION_OF_DONE)).toEqual({
        move: "wait",
        run: ran.at(-1),
      });
    });

    it("drops the Task when the user drops it", () => {
      const ran = runs(...reviewed(meeting(), decided("definition-of-done", { kind: "drop" })));

      expect(nextMove(publishing, ran, DEFINITION_OF_DONE)).toEqual({ move: "drop" });
    });

    it("doesn't check again as Resolve's Test goes back to Publish", () => {
      const conflicted: StageOutcome = {
        status: "failed",
        error: "office/task-1 no longer applies cleanly on main on origin.",
        baseMoved: { conflictedFiles: ["a.ts"] },
      };
      const ran = runs(
        ["write", meeting(1, 2)],
        ["check", done],
        ["review", meeting()],
        ["publish", conflicted],
        [RESOLVE_KEY, takingBack([], 2)],
        [RESOLVE_TEST_KEY, done],
      );

      expect(nextMove(publishing, ran, DEFINITION_OF_DONE)).toMatchObject({
        move: "run",
        stage: publish,
      });
    });

    describe("runs recorded before the check moved before Publish", () => {
      it("go on past Publish when the check would ask before it now", () => {
        expect(nextMove(publishing, publishedUnchecked(), DEFINITION_OF_DONE)).toEqual({
          move: "complete",
        });
      });

      it("wait on a Decision still open on the Publish run, and replay its answer", () => {
        const open = publishedUnchecked(decided("definition-of-done"));
        expect(nextMove(publishing, open, DEFINITION_OF_DONE)).toEqual({
          move: "wait",
          run: open[3],
        });

        const markedDone = publishedUnchecked(decided("definition-of-done", { kind: "mark-done" }));
        expect(nextMove(publishing, markedDone, DEFINITION_OF_DONE)).toEqual({ move: "complete" });
      });

      it("replay one more round as answered, passing over Resolve, with every statement when none is unmet now", () => {
        const conflicted: StageOutcome = {
          status: "failed",
          error: "office/task-1 no longer applies cleanly on main on origin.",
          baseMoved: { conflictedFiles: ["a.ts"] },
        };
        const answer = { kind: "one-more-round", guidance: undefined } as const;
        const ran = runs(
          ["write", meeting(1, 2)],
          ["check", done],
          ["review", meeting(1)],
          ["publish", conflicted],
          [RESOLVE_KEY, done],
          [RESOLVE_TEST_KEY, done],
          ["publish", done, decided("definition-of-done", answer)],
        );

        expect(nextMove(publishing, ran, DEFINITION_OF_DONE)).toMatchObject({
          move: "run",
          stage: publishing[2],
          carriedFailure: {
            stageKey: "review",
            error:
              "The Definition of Done isn't reported met:\n- The name shows\n- The name persists",
          },
        });
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

/** The write and the check done, then the Gate reached, with what the user did there. */
function atTheGate(action?: GateAction, ...after: readonly Ran[]): StageRun[] {
  const ran = runs(["write", done], ["check", done], ["look", GATE_REACHED], ...after);
  const gate = ran[2];
  if (!gate) throw new Error("The Gate wasn't reached.");
  ran[2] = { ...gate, gateAction: action };
  return ran;
}

describe("nextMove at a Gate", () => {
  const gated: Stage[] = [
    agentStage("write"),
    scriptStage("check", { goBackTo: "write", rounds: 1 }),
    { kind: "gate", key: "look", name: "Look", optional: false },
    scriptStage("ship"),
  ];
  const sendBack: GateAction = {
    kind: "send-back",
    stageKey: "write",
    feedback: "The button is too small.",
  };
  const sentBack = { gateKey: "look", feedback: "The button is too small." };

  it("waits for the user", () => {
    const ran = atTheGate();

    expect(nextMove(gated, ran, NO_DEFINITION_OF_DONE)).toEqual({ move: "wait", run: ran[2] });
  });

  it("goes on to the next Stage once the user continues, or drops the Task", () => {
    expect(nextMove(gated, atTheGate({ kind: "continue" }), NO_DEFINITION_OF_DONE)).toMatchObject({
      move: "run",
      stage: { key: "ship" },
    });
    expect(nextMove(gated, atTheGate({ kind: "drop" }), NO_DEFINITION_OF_DONE)).toEqual({
      move: "drop",
    });
  });

  it("sends the work back to the chosen Stage with the feedback, using no round", () => {
    expect(nextMove(gated, atTheGate(sendBack), NO_DEFINITION_OF_DONE)).toEqual({
      move: "run",
      stage: gated[0],
      carriedFailure: undefined,
      sentBack,
    });
    // The check's one round is still there for it.
    const failedAfter = atTheGate(sendBack, ["write", done], ["check", failed("A test fails.")]);
    expect(nextMove(gated, failedAfter, NO_DEFINITION_OF_DONE)).toEqual({
      move: "run",
      stage: gated[0],
      carriedFailure: { stageKey: "check", error: "A test fails.", round: 1, rounds: 1 },
      sentBack: undefined,
    });
    // Past the Stage it went back to, the feedback stays with it.
    expect(
      nextMove(gated, atTheGate(sendBack, ["write", done]), NO_DEFINITION_OF_DONE),
    ).toMatchObject({ move: "run", stage: { key: "check" }, sentBack: undefined });
  });

  it("keeps the feedback for a sent-back Stage the user held", () => {
    const stopped: StageOutcome = { status: "failed", error: "Stopped.", interrupted: "stop" };

    expect(nextMove(gated, atTheGate(sendBack, ["write", stopped]), NO_DEFINITION_OF_DONE)).toEqual(
      { move: "run", stage: gated[0], carriedFailure: undefined, sentBack },
    );
  });

  it("keeps the feedback for a sent-back Stage that reached its budget, once the user raises it", () => {
    const overBudget: StageOutcome = {
      status: "failed",
      error: "Over.",
      budgetReached: { used: 120_000, budget: 100_000 },
    };
    const raise = decided("budget", { kind: "raise-budget", tokens: 120_000 });

    expect(
      nextMove(gated, atTheGate(sendBack, ["write", overBudget, raise]), NO_DEFINITION_OF_DONE),
    ).toEqual({ move: "run", stage: gated[0], carriedFailure: undefined, sentBack });
  });

  it("waits at the Gate again after the work it sent back", () => {
    const ran = atTheGate(sendBack, ["write", done], ["check", done], ["look", GATE_REACHED]);

    expect(nextMove(gated, ran, NO_DEFINITION_OF_DONE)).toEqual({ move: "wait", run: ran[5] });
  });

  it("refuses work sent back to a Stage that isn't earlier", () => {
    const ran = atTheGate({ ...sendBack, stageKey: "ship" });

    expect(() => nextMove(gated, ran, NO_DEFINITION_OF_DONE)).toThrow(/isn't earlier/);
  });
});

describe("unmetStatements", () => {
  it("counts every report so far, which a Script Stage never gives", () => {
    const ran = runs(["write", meeting(1)], ["look", meeting(2)], ["check", done]);

    expect(unmetStatements(DEFINITION_OF_DONE, ran)).toEqual([]);
    expect(unmetStatements(DEFINITION_OF_DONE, ran.slice(0, 1))).toEqual(["The name persists"]);
    expect(unmetStatements(DEFINITION_OF_DONE, [])).toEqual(DEFINITION_OF_DONE);
  });
});

describe("reportedMet", () => {
  it("keeps a statement once any report met it, when later reports leave it out", () => {
    const ran = runs(["write", meeting(2)], ["look", meeting(1)], ["check", done]);

    expect(reportedMet(ran)).toEqual([1, 2]);
    expect(reportedMet([...ran, ...runs(["look", meeting()])])).toEqual([1, 2]);
    expect(reportedMet([])).toEqual([]);
  });

  it("takes back only what a later report lists as no longer met, until a report meets it again", () => {
    const ran = runs(["write", meeting(1, 2)], ["look", takingBack([], 2)]);

    expect(reportedMet(ran)).toEqual([1]);
    expect(reportedMet([...ran, ...runs(["write", meeting(2)])])).toEqual([1, 2]);
  });
});

describe("reportedOutOfReach", () => {
  it("adds up across reports, keeping the latest why", () => {
    const onWindows: StageOutcome = {
      status: "done",
      summary: "Done.",
      definitionOfDoneMet: [],
      definitionOfDoneOutOfReach: [{ statement: 2, why: "Windows." }],
    };
    const ran = runs(["write", outOfReach([], 1, 2)], ["look", meeting()], ["look", onWindows]);

    expect(reportedOutOfReach(ran)).toEqual([
      { statement: 1, why: "Live." },
      { statement: 2, why: "Windows." },
    ]);
    expect(reportedOutOfReach([])).toEqual([]);
  });

  it("drops a statement a later report meets", () => {
    const ran = runs(["write", outOfReach([], 1, 2)], ["look", meeting(1)], ["check", done]);

    expect(reportedOutOfReach(ran)).toEqual([{ statement: 2, why: "Live." }]);
  });

  it("counts only statements not reported met", () => {
    expect(reportedOutOfReach(runs(["write", meeting(1)], ["look", outOfReach([], 1, 2)]))).toEqual(
      [{ statement: 2, why: "Live." }],
    );
  });
});
