import { describe, expect, it } from "vitest";
import { reportedMet, reportedOutOfReach, unmetStatements } from "./definition-of-done-reports.js";
import { GATE_REACHED } from "./gate.js";
import {
  gateChecksDefinitionOfDone,
  nextMove,
  routeCounts,
  routesFollowed,
} from "./pipeline-walk.js";
import { asFlow, pipelineOrder, type FlowStage } from "./flow.js";
import {
  CONFLICT_ROUTE_LIMIT,
  ENDED_CONFLICT,
  RESOLVE_GATE_KEY,
  RESOLVE_KEY,
  RESOLVE_TEST_KEY,
} from "./publish-stages.js";
import {
  choiceCondition,
  type ConditionGroup,
  type ConditionTest,
  plainRoute,
  type Route,
} from "./route.js";
import type { KeptOnFailure, KeptStage } from "./routes-back.js";
import type { Stage } from "./stage.js";
import type { CommandOutcome, StageCommandPurpose, StageCommandRun } from "./stage-command-run.js";
import {
  NO_STAGE_TOKENS,
  type GateAction,
  type StageDecisionKind,
  type StageOutcome,
  type StageRun,
  type StageRunDecision,
  type WalkAnswer,
} from "./stage-run.js";

/**
 * An Agent Stage, with the on-failure setting a previous release kept when `onFailure` is given,
 * which the walk reads as its failure route back.
 */
function agentStage(key: string, onFailure?: KeptOnFailure): KeptStage {
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

/** A Script Stage, with a kept on-failure setting as `agentStage` takes it. */
function scriptStage(key: string, onFailure?: KeptOnFailure): KeptStage {
  return {
    kind: "script",
    key,
    name: key,
    optional: false,
    command: "test",
    ...(onFailure && { onFailure }),
  };
}

/** A Publish Stage, with a kept on-failure setting as `agentStage` takes it. */
function publishOf(key: string, onFailure?: KeptOnFailure): KeptStage {
  return { kind: "publish", key, name: key, optional: false, ...(onFailure && { onFailure }) };
}

/**
 * The `publish` Stage as the releases before Publish was a kind of its own kept it, a Script Stage
 * running `publish`, which `asFlow` reads as a Publish Stage with its conflict chain drawn in.
 */
function keptPublish(fields: { readonly afterConflict?: "publish" | "review" } = {}): KeptStage {
  return { ...scriptStage("publish"), command: "publish", ...fields } as KeptStage;
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

const sendingBack = (guidedBy?: string): WalkAnswer => ({
  kind: "send-back",
  to: "implement",
  guidance: "Cap the workers' memory.",
  ...(guidedBy !== undefined && { guidedBy }),
});

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

  it("asks of a conflict at Publish asked about before the conflict chain, or with no Conflict route, then runs it again, continues or drops", () => {
    const publishing = [
      agentStage("write"),
      { ...keptPublish(), onFailure: { goBackTo: "write", rounds: 2 } },
      agentStage("after"),
    ];
    const asPublished = expect.objectContaining({ kind: "publish", key: "publish" });
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
      question: { kind: "base-moved", stage: asPublished, error },
    });
    const waiting = runs(before, ["publish", moved, decided("base-moved")]);
    expect(nextMove(publishing, waiting, NO_DEFINITION_OF_DONE)).toMatchObject({ move: "wait" });
    const again = decided("base-moved", { kind: "one-more-round", guidance: undefined });
    expect(
      nextMove(publishing, runs(before, ["publish", moved, again]), NO_DEFINITION_OF_DONE),
    ).toEqual({
      move: "run",
      stage: asPublished,
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
    const publish = keptPublish({ afterConflict: "review" });
    const pipeline = [agentStage("write"), scriptStage("check"), publish];
    const flow = pipelineOrder(asFlow(pipeline));
    const drawn = (key: string): FlowStage => {
      const stage = flow.find((candidate) => candidate.key === key);
      if (!stage) throw new Error(`No "${key}" was drawn in.`);
      return stage;
    };
    const asPublished = expect.objectContaining({ kind: "publish", key: "publish" });
    const error = "office/task-1 no longer applies cleanly on main on origin.";
    /** A conflict as the releases before Publish's results kept it: failed, with the base moved. */
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
    /** `times` conflicts, each resolved, tested and continued at the Gate, then one more. */
    function conflictedTimes(times: number): StageRun[] {
      const rounds = Array.from({ length: times }, (): readonly Ran[] => [
        ["publish", conflicted],
        [RESOLVE_KEY, done],
        [RESOLVE_TEST_KEY, done],
        [RESOLVE_GATE_KEY, done],
      ]).flat();
      const ran = runs(...before, ...rounds, ["publish", conflicted]);
      return ran.map((run) =>
        run.stageKey === RESOLVE_GATE_KEY ? { ...run, gateAction: { kind: "continue" } } : run,
      );
    }

    it("replays an older Task's conflict along the Conflict route to the drawn Resolve, carrying it", () => {
      const ran = runs(...before, ["publish", conflicted]);

      expect(flow.map(({ key }) => key)).toEqual([
        "write",
        RESOLVE_KEY,
        "check",
        RESOLVE_TEST_KEY,
        RESOLVE_GATE_KEY,
        "publish",
      ]);
      expect(nextMove(pipeline, ran, NO_DEFINITION_OF_DONE)).toEqual({
        move: "run",
        stage: drawn(RESOLVE_KEY),
        carriedFailure: { stageKey: "publish", error, round: 1, rounds: CONFLICT_ROUTE_LIMIT },
        sentBack: undefined,
      });
    });

    it("follows a Conflict route of a Publish Stage's own on its Conflict result", () => {
      const own = [
        routed(agentStage("write"), plainRoute("publish")),
        routed(agentStage("fix"), plainRoute("publish")),
        routed(
          publishOf("publish"),
          { to: "fix", condition: ENDED_CONFLICT, limit: 1 },
          plainRoute(null),
        ),
      ];
      const conflict: StageOutcome = { ...conflicted, publishResult: "conflict" };

      expect(
        nextMove(own, runs(["write", done], ["publish", conflict]), NO_DEFINITION_OF_DONE),
      ).toMatchObject({
        move: "run",
        stage: { key: "fix" },
        carriedFailure: { stageKey: "publish", error, round: 1, rounds: 1 },
      });
    });

    it("publishes automatically after the Test when the Publish asked for no review", () => {
      const automaticPipeline = [agentStage("write"), scriptStage("check"), keptPublish()];
      const conflictedRuns: readonly Ran[] = [...before, ["publish", conflicted]];

      const tested = runs(...conflictedRuns, [RESOLVE_KEY, done], [RESOLVE_TEST_KEY, done]);
      expect(nextMove(automaticPipeline, tested, NO_DEFINITION_OF_DONE)).toMatchObject({
        move: "run",
        stage: { kind: "publish", key: "publish" },
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

    it("doesn't check the Definition of Done again at the Publish conflict handling returns to", () => {
      const automaticPipeline = [agentStage("write"), scriptStage("check"), keptPublish()];
      const ran = runs(
        ["write", meeting(1, 2)],
        ["check", done],
        ["publish", conflicted],
        [RESOLVE_KEY, takingBack([], 2)],
        [RESOLVE_TEST_KEY, done],
      );

      expect(nextMove(automaticPipeline, ran, DEFINITION_OF_DONE)).toMatchObject({
        move: "run",
        stage: { key: "publish" },
      });
      const notMet = runs(["write", meeting(1)], ["check", done]);
      expect(nextMove(automaticPipeline, notMet, DEFINITION_OF_DONE)).toMatchObject({
        move: "ask",
        question: { kind: "definition-of-done", before: { key: "publish" } },
      });
    });

    it("never runs a Stage of conflict handling as the Definition of Done's one more round", () => {
      const twoPublishes = [...pipeline, publishOf("publish-2")];
      const ran = continuedAtTheGate(
        runs(
          ["write", meeting(1)],
          ["check", done],
          ["publish", conflicted],
          [RESOLVE_KEY, done],
          [RESOLVE_TEST_KEY, done],
          [RESOLVE_GATE_KEY, done],
          ["publish", done],
        ),
        2,
      );

      expect(nextMove(twoPublishes, ran, DEFINITION_OF_DONE)).toMatchObject({
        move: "ask",
        run: { id: ran.at(-1)?.id },
        question: {
          kind: "definition-of-done",
          again: { key: "write" },
          before: { key: "publish-2" },
        },
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
      expect(nextMove(pipeline, continued, NO_DEFINITION_OF_DONE)).toEqual({
        move: "run",
        stage: asPublished,
        carriedFailure: undefined,
        sentBack: undefined,
      });
      const published = continuedAtTheGate(runs(...resolvedOnce, ["publish", done]), 2);
      expect(nextMove(pipeline, published, NO_DEFINITION_OF_DONE)).toEqual({ move: "complete" });
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
      expect(nextMove(pipeline, conflictedTimes(1), NO_DEFINITION_OF_DONE)).toMatchObject({
        move: "run",
        stage: { key: RESOLVE_KEY },
        carriedFailure: { stageKey: "publish", round: 2, rounds: 3 },
      });
    });

    it("asks at the Conflict route's limit, the older conflicts counted, as every route's limit asks", () => {
      const ran = conflictedTimes(3);
      const move = nextMove(pipeline, ran, NO_DEFINITION_OF_DONE);

      expect(move).toMatchObject({
        move: "ask",
        run: { id: ran.at(-1)?.id },
        question: {
          kind: "route-limit",
          stage: asPublished,
          atLimit: { route: { to: RESOLVE_KEY }, times: 3, limit: 3, back: true },
        },
      });
      const last = ran.at(-1);
      if (!last) throw new Error("No conflict came.");
      const once = {
        id: "decision-route-limit",
        kind: "route-limit",
        options: [{ kind: "one-more-round", guidance: undefined, to: RESOLVE_KEY }],
        answer: { kind: "one-more-round", guidance: undefined, to: RESOLVE_KEY },
      } as const;
      const answered = [...ran.slice(0, -1), { ...last, decisions: [once] }];
      expect(nextMove(pipeline, answered, NO_DEFINITION_OF_DONE)).toMatchObject({
        move: "run",
        stage: { key: RESOLVE_KEY },
        carriedFailure: { stageKey: "publish", error, round: 4, rounds: 4 },
      });
    });

    it("replays an older Task whose fourth conflict Resolve left to the user", () => {
      const ran = conflictedTimes(3);
      const leftToYou = failed("The conflict at Publish came back after Resolve too often.");
      const resolved = decided("base-moved", { kind: "resolved-in-worktree" });

      expect(
        nextMove(
          pipeline,
          [...ran, ...runs([RESOLVE_KEY, leftToYou, resolved])].map((run, index) => ({
            ...run,
            id: `run-${index + 1}`,
            number: index + 1,
          })),
          NO_DEFINITION_OF_DONE,
        ),
      ).toEqual({
        move: "run",
        stage: drawn(RESOLVE_KEY),
        carriedFailure: undefined,
        sentBack: undefined,
      });
    });

    it("asks the user directly when a Stage of conflict handling fails with no failure route, then runs it again, guided, or drops", () => {
      const gaveUp = failed("These files still hold conflict markers.");
      const asked = runs(...before, ["publish", conflicted], [RESOLVE_KEY, gaveUp]);
      const resolve = drawn(RESOLVE_KEY);

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

    it("asks a Stage failing with no failure route outside conflict handling as usual", () => {
      const ran = runs(["write", failed("It broke.")]);

      expect(nextMove(pipeline, ran, NO_DEFINITION_OF_DONE)).toMatchObject({
        move: "ask",
        question: { kind: "no-retries-left" },
      });
    });

    it("asks to publish again or drop when no route takes Conflict, and publishes again as answered", () => {
      const noChain = [agentStage("write"), publishOf("publish")];
      const conflict: StageOutcome = { ...conflicted, publishResult: "conflict" };

      expect(
        nextMove(noChain, runs(["write", done], ["publish", conflict]), NO_DEFINITION_OF_DONE),
      ).toEqual({
        move: "ask",
        run: expect.objectContaining({ stageKey: "publish" }),
        question: { kind: "base-moved", stage: noChain[1], error },
      });
      const again = decided("base-moved", { kind: "one-more-round", guidance: undefined });
      expect(
        nextMove(
          noChain,
          runs(["write", done], ["publish", conflict, again]),
          NO_DEFINITION_OF_DONE,
        ),
      ).toMatchObject({ move: "run", stage: noChain[1] });
    });
  });

  describe("after publishing failed", () => {
    const shipped = { kind: "merged", branch: "office/task-1", commit: "c0ffee" } as const;
    const afterFailed: StageOutcome = {
      status: "failed",
      error: "Published; after publishing failed: deploy failed.",
      afterPublishingFailed: shipped,
      publishResult: "after-publishing-failed",
    };

    it("asks as it always did when no route takes it, and stays at Publish as answered", () => {
      const pipeline = [agentStage("write"), publishOf("publish"), agentStage("after")];

      expect(
        nextMove(pipeline, runs(["write", done], ["publish", afterFailed]), NO_DEFINITION_OF_DONE),
      ).toMatchObject({
        move: "ask",
        question: { kind: "after-publishing-failed", stage: { key: "publish" } },
      });
      const retry = decided("after-publishing-failed", {
        kind: "one-more-round",
        guidance: undefined,
      });
      expect(
        nextMove(
          pipeline,
          runs(["write", done], ["publish", afterFailed, retry]),
          NO_DEFINITION_OF_DONE,
        ),
      ).toMatchObject({ move: "run", stage: { key: "publish" } });
    });

    it("follows a route that takes it, carrying the error", () => {
      const pipeline = [
        routed(agentStage("write"), plainRoute("publish")),
        routed(
          publishOf("publish"),
          when("notify", { kind: "stage", stage: null, is: "after-publishing-failed" }),
          plainRoute(null),
        ),
        routed(agentStage("notify"), plainRoute(null)),
      ];

      expect(
        nextMove(pipeline, runs(["write", done], ["publish", afterFailed]), NO_DEFINITION_OF_DONE),
      ).toMatchObject({
        move: "run",
        stage: { key: "notify" },
        carriedFailure: {
          stageKey: "publish",
          error: afterFailed.status === "failed" ? afterFailed.error : "",
        },
      });
    });

    it("never takes a Failed Publish as a Conflict or After publishing failed, nor those as Failed", () => {
      const pipeline = [
        routed(agentStage("write"), plainRoute("publish")),
        routed(publishOf("publish"), when("write", endedFailed), plainRoute(null)),
      ];

      expect(
        nextMove(pipeline, runs(["write", done], ["publish", afterFailed]), NO_DEFINITION_OF_DONE),
      ).toMatchObject({ move: "ask", question: { kind: "after-publishing-failed" } });
      const refused: StageOutcome = {
        status: "failed",
        error: "Push refused.",
        publishResult: "failed",
      };
      expect(
        nextMove(pipeline, runs(["write", done], ["publish", refused]), NO_DEFINITION_OF_DONE),
      ).toMatchObject({
        move: "run",
        stage: { key: "write" },
        carriedFailure: { stageKey: "publish" },
      });
    });
  });

  it("carries the error into the next run only", () => {
    const ran = runs(["write", done], ["check", failed("2 tests fail.")], ["write", done]);

    expect(nextMove(stages, ran, NO_DEFINITION_OF_DONE)).toMatchObject({
      stage: { key: "check" },
      carriedFailure: undefined,
    });
  });

  it("asks the user once a kept loop's route back has gone back as many times as it may", () => {
    const ran = runs(...checkUsedUp);

    expect(nextMove(stages, ran, NO_DEFINITION_OF_DONE)).toEqual({
      move: "ask",
      run: ran[5],
      question: {
        kind: "no-retries-left",
        stage: stages[1],
        error: "Third.",
        atLimit: {
          route: {
            to: "write",
            toName: "write",
            condition: { combine: "all", tests: [{ kind: "stage", stage: null, is: "failed" }] },
            limit: 2,
          },
          times: 2,
          limit: 2,
          back: true,
        },
        others: [{ to: "look", toName: "look", condition: null, limit: null }],
        sendBackTo: stages[0],
      },
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
      question: {
        kind: "no-retries-left",
        stage: stages[0],
        error: "The session ended.",
        atLimit: undefined,
        others: [],
        sendBackTo: undefined,
      },
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

    describe("a failed Script Stage sent back", () => {
      const implementThenTests = [agentStage("implement"), scriptStage("tests")];

      it("offers the last Agent Stage the walk ran to send the work back to", () => {
        const ran = runs(["implement", done], ["tests", failed("Workers ran out of memory.")]);

        expect(nextMove(implementThenTests, ran, NO_DEFINITION_OF_DONE)).toMatchObject({
          move: "ask",
          question: { kind: "no-retries-left", sendBackTo: { key: "implement" } },
        });
      });

      it("offers none when the walk ran no Agent Stage before it", () => {
        const ran = runs(["tests", failed("Workers ran out of memory.")]);

        expect(
          nextMove([scriptStage("tests"), agentStage("implement")], ran, NO_DEFINITION_OF_DONE),
        ).toMatchObject({
          move: "ask",
          question: { kind: "no-retries-left", sendBackTo: undefined },
        });
      });

      it("runs Implement with the failure and the CTO's words, using a round of Tests", () => {
        const ran = runs(
          ["implement", done],
          [
            "tests",
            failed("Workers ran out of memory."),
            decided("no-retries-left", sendingBack("cto")),
          ],
        );

        expect(nextMove(implementThenTests, ran, NO_DEFINITION_OF_DONE)).toEqual({
          move: "run",
          stage: implementThenTests[0],
          carriedFailure: {
            stageKey: "tests",
            error: "Workers ran out of memory.",
            round: 1,
            rounds: 1,
            guidance: "Cap the workers' memory.",
            guidedBy: "cto",
          },
          sentBack: undefined,
        });
      });

      it("goes on from Implement by its routes, and asks again when Tests fails again", () => {
        const ran = runs(
          ["implement", done],
          [
            "tests",
            failed("Workers ran out of memory."),
            decided("no-retries-left", sendingBack()),
          ],
          ["implement", done],
          ["tests", failed("Still out of memory.")],
        );

        expect(nextMove(implementThenTests, ran.slice(0, 3), NO_DEFINITION_OF_DONE)).toMatchObject({
          move: "run",
          stage: { key: "tests" },
          carriedFailure: undefined,
        });
        expect(nextMove(implementThenTests, ran, NO_DEFINITION_OF_DONE)).toMatchObject({
          move: "ask",
          run: { stageKey: "tests", number: 4 },
          question: { kind: "no-retries-left", error: "Still out of memory." },
        });
      });

      it("follows none of a used-up failure route's times, counting the send-back on its own", () => {
        const ran = answeredUsedUp({ kind: "send-back", to: "write", guidance: undefined });

        expect(nextMove(stages, ran, NO_DEFINITION_OF_DONE)).toEqual({
          move: "run",
          stage: stages[0],
          carriedFailure: { stageKey: "check", error: "Third.", round: 1, rounds: 1 },
          sentBack: undefined,
        });
        expect(routesFollowed(stages, ran).get(ran.at(-1)?.id ?? "")).toBeUndefined();
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
    const publish = publishOf("publish", { goBackTo: "write", rounds: 1 });
    const publishing = [agentStage("write"), scriptStage("check"), agentStage("review"), publish];
    /** The Pipeline as an older release kept it, its conflict chain drawn in as it is read. */
    const keptPublishing = [
      ...publishing.slice(0, 3),
      { ...keptPublish(), onFailure: { goBackTo: "write", rounds: 1 } },
    ];

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

    it("still checks a Publish-first Pipeline at the end after its conflict chain ran, which it starts after", () => {
      const publishFirst = [keptPublish({ afterConflict: "review" }), agentStage("notes")];
      expect(nextMove(publishFirst, [], DEFINITION_OF_DONE)).toMatchObject({
        move: "run",
        stage: { kind: "publish", key: "publish" },
      });
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

      expect(nextMove(keptPublishing, ran, DEFINITION_OF_DONE)).toMatchObject({
        move: "run",
        stage: { kind: "publish", key: "publish" },
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

        expect(nextMove(keptPublishing, ran, DEFINITION_OF_DONE)).toMatchObject({
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

  describe("an optional Stage, as the conversion writes its routes", () => {
    const withOptional = [agentStage("write"), { ...agentStage("look"), optional: true }];
    const optionalBetween = [...withOptional, scriptStage("check")];
    const skippedRun: StageOutcome = { status: "done", summary: "Skipped.", skipped: true };

    it("passes it by once every statement of the Definition of Done is reported met", () => {
      expect(nextMove(withOptional, runs(["write", meeting(1, 2)]), DEFINITION_OF_DONE)).toEqual({
        move: "complete",
      });
      expect(
        nextMove(optionalBetween, runs(["write", meeting(1, 2)]), DEFINITION_OF_DONE),
      ).toMatchObject({ move: "run", stage: { key: "check" } });
    });

    it("runs while a statement isn't reported met", () => {
      expect(nextMove(withOptional, runs(["write", meeting(1)]), DEFINITION_OF_DONE)).toMatchObject(
        { move: "run", stage: { key: "look" } },
      );
    });

    it("replays a Skipped run the previous release recorded, and goes on after it", () => {
      const ran = runs(["write", meeting(1, 2)], ["look", skippedRun]);

      expect(nextMove(withOptional, ran, DEFINITION_OF_DONE)).toEqual({ move: "complete" });
      expect(nextMove(optionalBetween, ran, DEFINITION_OF_DONE)).toMatchObject({
        move: "run",
        stage: { key: "check" },
      });
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

function gateStage(key: string): Stage {
  return { kind: "gate", key, name: key, optional: false };
}

const publishStage: Stage = { kind: "publish", key: "publish", name: "publish", optional: false };

/** The write meeting the first statement of two, the Gate continued, then `after`. */
function continuedThen(...after: readonly Ran[]): StageRun[] {
  return continuedAtTheGate(
    runs(["write", meeting(1)], ["gate", GATE_REACHED], ...after),
    after.length + 1,
  );
}

describe("a Gate before Publish", () => {
  const gate = gateStage("gate");
  const publish = publishStage;
  const gateThenPublish = [agentStage("write"), gate, publish];

  it("is the Definition of Done check: Continue runs Publish unchecked, and the Task completes after it", () => {
    expect(nextMove(gateThenPublish, continuedThen(), DEFINITION_OF_DONE)).toMatchObject({
      move: "run",
      stage: publish,
    });
    expect(nextMove(gateThenPublish, continuedThen(["publish", done]), DEFINITION_OF_DONE)).toEqual(
      { move: "complete" },
    );
  });

  it("still is with Script Stages between it and Publish", () => {
    const withCheck = [agentStage("write"), gate, scriptStage("check"), publish];

    expect(nextMove(withCheck, continuedThen(["check", done]), DEFINITION_OF_DONE)).toMatchObject({
      move: "run",
      stage: publish,
    });
  });

  it("isn't with an Agent Stage between it and Publish, whose report the check waits for", () => {
    const withReview = [agentStage("write"), gate, agentStage("review"), publish];
    const ran = continuedThen(["review", meeting()]);

    expect(nextMove(withReview, ran, DEFINITION_OF_DONE)).toMatchObject({
      move: "ask",
      run: ran[2],
      question: { kind: "definition-of-done", unmet: ["The name persists"], before: publish },
    });
  });

  it("counts the Continue after the work it sent back reaches it again", () => {
    const sentBack: GateAction = { kind: "send-back", stageKey: "write", feedback: "Smaller." };
    const ran = continuedAtTheGate(
      runs(
        ["write", meeting(1)],
        ["gate", GATE_REACHED],
        ["write", meeting(1)],
        ["gate", GATE_REACHED],
      ),
    ).map((run, index) => (index === 1 ? { ...run, gateAction: sentBack } : run));

    expect(nextMove(gateThenPublish, ran, DEFINITION_OF_DONE)).toMatchObject({
      move: "run",
      stage: publish,
    });
  });

  it("replays a Definition of Done Decision already recorded on the Gate's or Publish's run", () => {
    const open = continuedAtTheGate(
      runs(["write", meeting(1)], ["gate", GATE_REACHED, decided("definition-of-done")]),
    );
    expect(nextMove(gateThenPublish, open, DEFINITION_OF_DONE)).toEqual({
      move: "wait",
      run: open[1],
    });

    const answer = { kind: "one-more-round", guidance: undefined } as const;
    const oneMoreRound = continuedAtTheGate(
      runs(["write", meeting(1)], ["gate", GATE_REACHED, decided("definition-of-done", answer)]),
    );
    expect(nextMove(gateThenPublish, oneMoreRound, DEFINITION_OF_DONE)).toMatchObject({
      move: "run",
      stage: { key: "write" },
      carriedFailure: { stageKey: "write", round: 1 },
    });

    const publishAsked = continuedThen(["publish", done, decided("definition-of-done")]);
    expect(nextMove(gateThenPublish, publishAsked, DEFINITION_OF_DONE)).toEqual({
      move: "wait",
      run: publishAsked[2],
    });
  });
});

/** `stage` with `routes` out of it, standing where its index puts it. */
function routed(stage: Stage, ...routes: Route[]): Stage {
  return { ...stage, routes };
}

/** A route to `to` while all of `tests` hold, with No limit. */
function when(to: string | null, ...tests: ConditionGroup["tests"]): Route {
  return { to, condition: { combine: "all", tests }, limit: null };
}

const unmet: ConditionGroup["tests"][number] = { kind: "definitionOfDone", is: "some-not-met" };
const allMet: ConditionGroup["tests"][number] = { kind: "definitionOfDone", is: "all-met" };
const endedFailed: ConditionGroup["tests"][number] = { kind: "stage", stage: null, is: "failed" };

/** The runs with `changedFiles` on the run of `stageKey`. */
function changing(ran: readonly StageRun[], stageKey: string, files: string[]): StageRun[] {
  return ran.map((run) => (run.stageKey === stageKey ? { ...run, changedFiles: files } : run));
}

const PUBLISH: Stage = { kind: "publish", key: "publish", name: "publish", optional: false };

const withFix = (checkRoutes: Route[]) => [
  routed(agentStage("write"), plainRoute("check")),
  routed(scriptStage("check", { goBackTo: "write", rounds: 1 }), ...checkRoutes),
  routed(agentStage("fix"), plainRoute("publish")),
  routed(PUBLISH, plainRoute(null)),
];

// A run kept before changed files were recorded holds neither files test.
const unrecorded = (...decisions: StageRunDecision[]) =>
  runs(["write", meeting(1, 2), ...decisions]);

/** Write's run, with the condition commands recorded on it. */
function weighed(...commandRuns: StageCommandRun[]): StageRun[] {
  return runs(["write", done]).map((run) => ({ ...run, commandRuns }));
}

/** Write going on by `writeRoutes`, Review and Fix both on to Check, which ends the walk. */
const choosingFlow = (...writeRoutes: Route[]) => [
  routed(agentStage("write"), ...writeRoutes),
  routed(agentStage("review"), plainRoute("check")),
  routed(agentStage("fix"), plainRoute("check")),
  routed(scriptStage("check"), plainRoute(null)),
];

/** Write ended `outcome`, its Agent having chosen `to` when given. */
function wrote(outcome: StageOutcome, to?: string | null): StageRun[] {
  const [run] = runs(["write", outcome]);
  if (!run) throw new Error("Write never ran.");
  return [{ ...run, choice: to === undefined ? undefined : { to, reason: "Because." } }];
}

describe("nextMove over routes", () => {
  // Write goes to Review while something is unmet, else straight to Check, which joins both paths.
  const branching = [
    routed(agentStage("write"), when("review", unmet), plainRoute("check")),
    routed(agentStage("review"), plainRoute("check")),
    routed(scriptStage("check"), plainRoute(null)),
  ];

  it("follows the first route whose condition holds, the other side not taken", () => {
    expect(nextMove(branching, runs(["write", meeting(1)]), DEFINITION_OF_DONE)).toMatchObject({
      move: "run",
      stage: { key: "review" },
    });
    expect(nextMove(branching, runs(["write", meeting(1, 2)]), DEFINITION_OF_DONE)).toMatchObject({
      move: "run",
      stage: { key: "check" },
    });
  });

  it("joins the paths again at a Stage both lead to", () => {
    const ran = runs(["write", meeting(1)], ["review", meeting(2)]);

    expect(nextMove(branching, ran, DEFINITION_OF_DONE)).toMatchObject({
      move: "run",
      stage: { key: "check" },
    });
    expect(nextMove(branching, [...ran, ...runs(["check", done])], DEFINITION_OF_DONE)).toEqual({
      move: "complete",
    });
  });

  it("ends the walk at a route to End in the middle of the order", () => {
    const endingEarly = [
      routed(agentStage("write"), when(null, allMet), plainRoute("review")),
      routed(agentStage("review"), plainRoute(null)),
    ];

    expect(nextMove(endingEarly, runs(["write", meeting(1, 2)]), DEFINITION_OF_DONE)).toEqual({
      move: "complete",
    });
  });

  it("follows a recorded run a route leads to without weighing again, and throws for one none does", () => {
    // Since the run, the user's edit made Write go to Review only once everything is met.
    const edited = [
      routed(agentStage("write"), when("review", allMet), plainRoute("check")),
      ...branching.slice(1),
    ];
    const ran = runs(["write", meeting(1)], ["review", meeting(2)]);

    expect(nextMove(edited, ran, DEFINITION_OF_DONE)).toMatchObject({
      move: "run",
      stage: { key: "check" },
    });
    const straight = [routed(agentStage("write"), plainRoute("check")), ...branching.slice(1)];
    expect(() => nextMove(straight, ran, DEFINITION_OF_DONE)).toThrow(/expected "check"/);
  });

  describe("when no route holds", () => {
    const byFiles = [
      routed(
        agentStage("write"),
        when("review", { kind: "stage", stage: null, is: "changed" }),
        when("check", { kind: "stage", stage: null, is: "unchanged" }),
      ),
      routed(agentStage("review"), plainRoute("check")),
      routed(scriptStage("check"), plainRoute(null)),
    ];

    it("asks the user on the run, offering each route by where it leads", () => {
      const ran = unrecorded();

      expect(nextMove(byFiles, ran, DEFINITION_OF_DONE)).toEqual({
        move: "ask",
        run: ran[0],
        question: {
          kind: "no-route-holds",
          stage: byFiles[0],
          routes: [
            { ...when("review", { kind: "stage", stage: null, is: "changed" }), toName: "review" },
            { ...when("check", { kind: "stage", stage: null, is: "unchanged" }), toName: "check" },
          ],
          why: undefined,
        },
      });
    });

    it("weighs the files the run changed", () => {
      const ran = changing(unrecorded(), "write", []);

      expect(nextMove(byFiles, ran, DEFINITION_OF_DONE)).toMatchObject({
        move: "run",
        stage: { key: "check" },
      });
    });

    it("waits on the Decision, then follows the route the user chose, notes and all, or drops", () => {
      const open = unrecorded(decided("no-route-holds"));
      expect(nextMove(byFiles, open, DEFINITION_OF_DONE)).toEqual({ move: "wait", run: open[0] });

      const toCheck = { kind: "follow-route", to: "check", guidance: "Skip the review." } as const;
      expect(
        nextMove(byFiles, unrecorded(decided("no-route-holds", toCheck)), DEFINITION_OF_DONE),
      ).toMatchObject({ move: "run", stage: { key: "check" } });
      expect(
        nextMove(
          byFiles,
          unrecorded(decided("no-route-holds", { kind: "follow-route", to: null })),
          DEFINITION_OF_DONE,
        ),
      ).toEqual({ move: "complete" });
      expect(
        nextMove(
          byFiles,
          unrecorded(decided("no-route-holds", { kind: "drop" })),
          DEFINITION_OF_DONE,
        ),
      ).toEqual({ move: "drop" });
    });

    it("checks the Definition of Done at End after the user chose it", () => {
      const ran = runs([
        "write",
        meeting(1),
        decided("no-route-holds", { kind: "follow-route", to: null }),
      ]);

      expect(nextMove(byFiles, ran, DEFINITION_OF_DONE)).toMatchObject({
        move: "ask",
        question: { kind: "definition-of-done", unmet: ["The name persists"], before: undefined },
      });
    });
  });

  describe("an Agent's choice rows", () => {
    const toFix = { ...when("fix", endedFailed), limit: 3 };
    const toReview: Route = {
      to: "review",
      condition: choiceCondition("it needs a look"),
      limit: 3,
    };
    const toEnd: Route = { to: null, condition: choiceCondition("nothing to do"), limit: 1 };
    const choosing = choosingFlow(toFix, toReview, toEnd, plainRoute("check"));

    it("follows the row the Agent chose", () => {
      expect(nextMove(choosing, wrote(done, "review"), NO_DEFINITION_OF_DONE)).toMatchObject({
        move: "run",
        stage: { key: "review" },
      });
      expect(nextMove(choosing, wrote(done, null), NO_DEFINITION_OF_DONE)).toEqual({
        move: "complete",
      });
    });

    it("follows Otherwise when the Agent chose none", () => {
      expect(nextMove(choosing, wrote(done), NO_DEFINITION_OF_DONE)).toMatchObject({
        move: "run",
        stage: { key: "check" },
      });
    });

    it("asks when no route holds with no choice and no Otherwise, saying the Agent chose none", () => {
      const ran = wrote(done);
      const noOtherwise = choosingFlow(toFix, toReview, toEnd);

      expect(nextMove(noOtherwise, ran, NO_DEFINITION_OF_DONE)).toEqual({
        move: "ask",
        run: ran[0],
        question: {
          kind: "no-route-holds",
          stage: noOtherwise[0],
          routes: [{ ...toFix, toName: "fix" }, { ...toReview, toName: "review" }, toEnd],
          why: undefined,
          choseNone: true,
        },
      });
    });

    it("follows only its failure route when the Stage failed, whatever the Agent chose", () => {
      expect(
        nextMove(choosing, wrote(failed("Broke."), "review"), NO_DEFINITION_OF_DONE),
      ).toMatchObject({
        move: "run",
        stage: { key: "fix" },
        carriedFailure: { stageKey: "write", error: "Broke." },
      });
    });
  });

  describe("a route that tests a Project command", () => {
    const lint: ConditionTest = { kind: "command", key: "lint" };
    const build: ConditionTest = { kind: "command", key: "build" };
    const byCommand = [
      routed(agentStage("write"), when("review", lint), plainRoute("check")),
      routed(agentStage("review"), plainRoute("check")),
      routed(scriptStage("check"), plainRoute(null)),
    ];
    const lintTest = { key: "lint", to: "review", routeIndex: 0, testPath: [0] };

    function conditionRun(
      outcome: CommandOutcome,
      purpose: StageCommandPurpose = "condition",
      condition = lintTest,
    ): StageCommandRun {
      return {
        purpose,
        commandLine: "npm run lint",
        outcome,
        exitCode: outcome === "passed" ? 0 : outcome === "failed" ? 1 : undefined,
        durationMs: 1000,
        output: outcome === "could-not-run" ? "The Project has no lint command." : "",
        condition,
      };
    }

    it("asks for the command's run once the walk weighs its test, with where the test is", () => {
      const ran = weighed();

      expect(nextMove(byCommand, ran, NO_DEFINITION_OF_DONE)).toEqual({
        move: "weigh-command",
        run: ran[0],
        stage: byCommand[0],
        condition: lintTest,
        route: { times: 0, limit: null },
      });
    });

    it("follows the route when the recorded command passed, and the next one when it failed", () => {
      expect(
        nextMove(byCommand, weighed(conditionRun("passed")), NO_DEFINITION_OF_DONE),
      ).toMatchObject({ move: "run", stage: { key: "review" } });
      expect(
        nextMove(byCommand, weighed(conditionRun("failed")), NO_DEFINITION_OF_DONE),
      ).toMatchObject({ move: "run", stage: { key: "check" } });
    });

    it("asks the no-route-holds Decision, saying why, when the command couldn't run or timed out", () => {
      expect(
        nextMove(byCommand, weighed(conditionRun("could-not-run")), NO_DEFINITION_OF_DONE),
      ).toMatchObject({
        move: "ask",
        question: {
          kind: "no-route-holds",
          why: "The condition's command `lint` couldn't run: The Project has no lint command.",
        },
      });
      expect(
        nextMove(byCommand, weighed(conditionRun("timed-out")), NO_DEFINITION_OF_DONE),
      ).toMatchObject({
        move: "ask",
        question: {
          kind: "no-route-holds",
          why: expect.stringMatching(/^The condition's command `lint` ran out of time/),
        },
      });
      expect(
        nextMove(byCommand, weighed(conditionRun("failed", "install")), NO_DEFINITION_OF_DONE),
      ).toMatchObject({
        move: "ask",
        question: {
          kind: "no-route-holds",
          why: "The install before the condition's command `lint` failed with exit code 1.",
        },
      });
    });

    it("weighs a command again that The Office stopped, its install's included", () => {
      for (const ran of [
        weighed(conditionRun("stopped")),
        weighed(conditionRun("stopped", "install")),
        weighed(conditionRun("passed", "install")),
      ]) {
        expect(nextMove(byCommand, ran, NO_DEFINITION_OF_DONE)).toMatchObject({
          move: "weigh-command",
          condition: lintTest,
        });
      }
      expect(
        nextMove(
          byCommand,
          weighed(conditionRun("stopped"), conditionRun("passed")),
          NO_DEFINITION_OF_DONE,
        ),
      ).toMatchObject({ move: "run", stage: { key: "review" } });
    });

    it("weighs the tests in order and asks for no command once the result is settled", () => {
      const anyOf: Route = {
        to: "review",
        condition: { combine: "any", tests: [lint, build] },
        limit: null,
      };
      const either = [
        routed(agentStage("write"), anyOf, plainRoute("check")),
        ...byCommand.slice(1),
      ];

      expect(
        nextMove(either, weighed(conditionRun("passed")), NO_DEFINITION_OF_DONE),
      ).toMatchObject({ move: "run", stage: { key: "review" } });
      expect(
        nextMove(either, weighed(conditionRun("failed")), NO_DEFINITION_OF_DONE),
      ).toMatchObject({
        move: "weigh-command",
        condition: { key: "build", to: "review", routeIndex: 0, testPath: [1] },
      });
    });

    it("follows a recorded run without running the command again", () => {
      expect(
        nextMove(
          byCommand,
          [...weighed(conditionRun("passed")), ...runs(["review", done])],
          NO_DEFINITION_OF_DONE,
        ),
      ).toMatchObject({ move: "run", stage: { key: "check" } });
    });
  });

  describe("when a Stage fails", () => {
    const toFixOnFailure = withFix([when("fix", endedFailed), plainRoute("publish")]);
    const failedTwice = runs(
      ["write", done],
      ["check", failed("First.")],
      ["write", done],
      ["check", failed("Second.")],
    );

    it("goes back by its kept loop first, then on by a failure route, carrying the failure", () => {
      expect(
        nextMove(toFixOnFailure, failedTwice.slice(0, 2), NO_DEFINITION_OF_DONE),
      ).toMatchObject({
        move: "run",
        stage: { key: "write" },
        carriedFailure: { stageKey: "check", round: 1 },
      });
      expect(nextMove(toFixOnFailure, failedTwice, NO_DEFINITION_OF_DONE)).toMatchObject({
        move: "run",
        stage: { key: "fix" },
        carriedFailure: { stageKey: "check", error: "Second.", round: 1, rounds: null },
      });
    });

    it("never carries a failure on by a route with no condition or another one", () => {
      const plainOnly = withFix([
        when("fix", { kind: "stage", stage: null, is: "done" }),
        plainRoute("publish"),
      ]);
      const failedOnlyOnce = withFix([
        when("fix", endedFailed, { kind: "stage", stage: null, is: "ran", times: 3 }),
        plainRoute("publish"),
      ]);

      for (const flow of [plainOnly, failedOnlyOnce]) {
        expect(nextMove(flow, failedTwice, NO_DEFINITION_OF_DONE)).toMatchObject({
          move: "ask",
          question: { kind: "no-retries-left", stage: { key: "check" }, error: "Second." },
        });
      }
    });

    it("weighs every route once the user continues with the issues, the outcome staying Failed", () => {
      const plainOnly = withFix([
        when("fix", { kind: "stage", stage: null, is: "done" }),
        plainRoute("publish"),
      ]);
      const accepted = failedTwice.map((run, index) =>
        index === 3
          ? { ...run, decisions: [decided("no-retries-left", { kind: "accept-issues" })] }
          : run,
      );

      expect(nextMove(plainOnly, accepted, NO_DEFINITION_OF_DONE)).toMatchObject({
        move: "run",
        stage: { key: "publish" },
      });
    });

    it("weighs a failure route's command test at its place among all the Stage's routes", () => {
      const lint: ConditionTest = { kind: "command", key: "lint" };
      const flow = withFix([
        when("fix", { kind: "stage", stage: null, is: "done" }),
        when("publish", endedFailed, lint),
        plainRoute(null),
      ]);
      const failedLint = {
        purpose: "condition",
        commandLine: "npm run lint",
        outcome: "failed",
        exitCode: 1,
        durationMs: 1000,
        output: "",
        // The kept loop's route back is the first of the Stage's routes, as `asFlow` reads it.
        condition: { key: "lint", to: "publish", routeIndex: 2, testPath: [1] },
      } satisfies StageCommandRun;
      const weighedLint = failedTwice.map((run, index) =>
        index === 3 ? { ...run, commandRuns: [failedLint] } : run,
      );
      const accepted = weighedLint.map((run, index) =>
        index === 3
          ? { ...run, decisions: [decided("no-retries-left", { kind: "accept-issues" })] }
          : run,
      );

      expect(nextMove(flow, failedTwice, NO_DEFINITION_OF_DONE)).toMatchObject({
        move: "weigh-command",
        condition: { key: "lint", to: "publish", routeIndex: 2, testPath: [1] },
      });
      // The recorded result is found again: no command runs twice.
      expect(nextMove(flow, weighedLint, NO_DEFINITION_OF_DONE)).toMatchObject({
        move: "ask",
        question: { kind: "no-retries-left", atLimit: { route: { to: "write" } } },
      });
      // Continuing with the issues weighs the routes as when the Stage ends done: none carries a failure.
      expect(nextMove(flow, accepted, NO_DEFINITION_OF_DONE)).toEqual({ move: "complete" });
    });
  });

  describe("the Definition of Done check", () => {
    // Write publishes only when it changed files; otherwise the walk ends with nothing published.
    const publishingWhenChanged = [
      routed(
        agentStage("write"),
        when("publish", { kind: "stage", stage: null, is: "changed" }),
        plainRoute(null),
      ),
      routed(PUBLISH, plainRoute(null)),
    ];

    it("runs as the walk enters Publish, and not again at End", () => {
      const ran = changing(runs(["write", meeting(1)]), "write", ["a.ts"]);

      expect(nextMove(publishingWhenChanged, ran, DEFINITION_OF_DONE)).toMatchObject({
        move: "ask",
        question: { kind: "definition-of-done", before: { key: "publish" } },
      });
      const calledMet = decided("definition-of-done", { kind: "mark-done" });
      const published = changing(
        runs(["write", meeting(1), calledMet], ["publish", done]),
        "write",
        ["a.ts"],
      );
      expect(nextMove(publishingWhenChanged, published, DEFINITION_OF_DONE)).toEqual({
        move: "complete",
      });
    });

    it("runs at End on a path that entered no Publish", () => {
      const ran = changing(runs(["write", meeting(1)]), "write", []);

      expect(nextMove(publishingWhenChanged, ran, DEFINITION_OF_DONE)).toMatchObject({
        move: "ask",
        question: { kind: "definition-of-done", before: undefined, again: { key: "write" } },
      });
    });
  });
});

/** `route` with the limit `limit`. */
function limited(route: Route, limit: number | null): Route {
  return { ...route, limit };
}

describe("nextMove at a route's limit", () => {
  // Review sends the work back to Write while something is unmet, at most once, else on to Publish.
  const reviewing = [
    routed(agentStage("write"), plainRoute("review")),
    routed(agentStage("review"), limited(when("write", unmet), 1), plainRoute("publish")),
    routed(PUBLISH, plainRoute(null)),
  ];
  const sentBackOnce: Ran[] = [
    ["write", meeting(1)],
    ["review", done],
    ["write", meeting(1)],
    ["review", { ...done, handoverNote: "The second name still doesn't persist." }],
  ];

  it("follows a route while it has times left, then asks rather than passing over it", () => {
    expect(nextMove(reviewing, runs(...sentBackOnce.slice(0, 2)), DEFINITION_OF_DONE)).toEqual({
      move: "run",
      stage: reviewing[0],
      carriedFailure: undefined,
      sentBack: undefined,
    });
    const ran = runs(...sentBackOnce);
    expect(nextMove(reviewing, ran, DEFINITION_OF_DONE)).toEqual({
      move: "ask",
      run: ran[3],
      question: {
        kind: "route-limit",
        stage: reviewing[1],
        atLimit: {
          route: { ...when("write", unmet), toName: "write", limit: 1 },
          times: 1,
          limit: 1,
          back: true,
        },
        others: [{ to: "publish", toName: "publish", condition: null, limit: null }],
        note: "The second name still doesn't persist.",
      },
    });
  });

  it("follows the route once more past its limit, then asks again the next time", () => {
    const onceMore = { kind: "one-more-round", guidance: "Persist it.", to: "write" } as const;
    const answered = runs(...sentBackOnce.slice(0, 3), [
      "review",
      done,
      { ...decided("route-limit", onceMore), options: [onceMore] },
    ]);

    expect(nextMove(reviewing, answered, DEFINITION_OF_DONE)).toMatchObject({
      move: "run",
      stage: { key: "write" },
      carriedFailure: undefined,
    });
    const again = [...answered, ...runs(["write", meeting(1)], ["review", done])].map(
      (run, index) => ({ ...run, id: `run-${index + 1}`, number: index + 1 }),
    );
    expect(nextMove(reviewing, again, DEFINITION_OF_DONE)).toMatchObject({
      move: "ask",
      question: { kind: "route-limit", atLimit: { times: 2, limit: 2 } },
    });
  });

  it("counts a route as the walk does, the time an answer allowed past its limit included", () => {
    const onceMore = { kind: "one-more-round", guidance: undefined, to: "write" } as const;
    const ran = runs(...sentBackOnce.slice(0, 3), [
      "review",
      done,
      { ...decided("route-limit", onceMore), options: [onceMore] },
    ]);

    expect(routeCounts(reviewing, ran, "review", reviewing[1]?.routes ?? [])).toEqual([
      { times: 2, limit: 2 },
      { times: 0, limit: null },
    ]);
  });

  /** Review at its route's limit the first time, the Decision answered `answer`. */
  const answered = (answer: WalkAnswer) =>
    runs(...sentBackOnce.slice(0, 3), ["review", done, decided("route-limit", answer)]);

  it("goes on by another route, or drops the Task, as the answer says", () => {
    expect(
      nextMove(reviewing, answered({ kind: "follow-route", to: "publish" }), DEFINITION_OF_DONE),
    ).toMatchObject({ move: "ask", question: { kind: "definition-of-done" } });
    expect(
      nextMove(reviewing, answered({ kind: "follow-route", to: "publish" }), NO_DEFINITION_OF_DONE),
    ).toMatchObject({ move: "run", stage: { key: "publish" } });
    expect(nextMove(reviewing, answered({ kind: "drop" }), DEFINITION_OF_DONE)).toEqual({
      move: "drop",
    });
  });

  it("asks at the limit of a route that leads on as well", () => {
    const onceOnly = [
      routed(agentStage("write"), limited(plainRoute("review"), 1)),
      routed(agentStage("review"), limited(when("write", unmet), 3), plainRoute(null)),
    ];
    const ran = runs(["write", meeting(1)], ["review", done], ["write", meeting(1)]);

    expect(nextMove(onceOnly, ran, DEFINITION_OF_DONE)).toMatchObject({
      move: "ask",
      question: {
        kind: "route-limit",
        atLimit: { route: { to: "review" }, times: 1, limit: 1, back: false },
        others: [],
      },
    });
  });

  it("passes a failure over a used-up failure route to the next one", () => {
    const twoWays = [
      routed(agentStage("write"), plainRoute("check")),
      routed(
        scriptStage("check"),
        limited(when("write", endedFailed), 1),
        when("fix", endedFailed),
        plainRoute("publish"),
      ),
      routed(agentStage("fix"), plainRoute("check")),
      routed(PUBLISH, plainRoute(null)),
    ];
    const ran = runs(
      ["write", done],
      ["check", failed("First.")],
      ["write", done],
      ["check", failed("Second.")],
    );

    expect(nextMove(twoWays, ran, NO_DEFINITION_OF_DONE)).toMatchObject({
      move: "run",
      stage: { key: "fix" },
      carriedFailure: { stageKey: "check", error: "Second.", round: 1, rounds: null },
    });
  });

  it("goes on by another route of a failed Stage whose failure route is used up", () => {
    const ran = answeredUsedUp({ kind: "follow-route", to: "look" });

    expect(nextMove(stages, ran, NO_DEFINITION_OF_DONE)).toMatchObject({
      move: "run",
      stage: { key: "look" },
      carriedFailure: undefined,
    });
  });
});

describe("routesFollowed", () => {
  it("replays an in-progress Task's runs as the times its kept loop's route back was followed", () => {
    const ran = runs(...checkUsedUp);

    expect(routesFollowed(stages, ran)).toEqual(
      new Map([
        ["run-1", { to: "check", times: 1, limit: null }],
        ["run-2", { to: "write", times: 1, limit: 2 }],
        ["run-3", { to: "check", times: 2, limit: null }],
        ["run-4", { to: "write", times: 2, limit: 2 }],
        ["run-5", { to: "check", times: 3, limit: null }],
      ]),
    );
  });

  it("counts the times an answer allowed past the limit", () => {
    const ran = [
      ...answeredUsedUp({ kind: "more-rounds", rounds: 2 }),
      ...runs(["write", done]).map((run) => ({ ...run, id: "run-7", number: 7 })),
    ];

    expect(routesFollowed(stages, ran).get("run-6")).toEqual({ to: "write", times: 3, limit: 4 });
  });

  it("keeps the routes followed before a run the walk can't replay", () => {
    const ran = runs(["write", done], ["look", done], ["check", done]);

    expect(routesFollowed(stages, ran)).toEqual(new Map());
    expect(routesFollowed(stages, runs(["write", done], ["check", done], ["write", done]))).toEqual(
      new Map([["run-1", { to: "check", times: 1, limit: null }]]),
    );
  });
});

function flowOf(pipelineStages: readonly Stage[]): FlowStage[] {
  return pipelineOrder(asFlow(pipelineStages));
}

describe("gateChecksDefinitionOfDone", () => {
  const gate = gateStage;
  const publish = publishStage;

  it("is true for a Gate with only Script Stages, or none, before the Publish after it", () => {
    expect(
      gateChecksDefinitionOfDone(flowOf([agentStage("write"), gate("look"), publish]), 1),
    ).toBe(true);
    const withCheck = flowOf([agentStage("write"), gate("look"), scriptStage("check"), publish]);
    expect(gateChecksDefinitionOfDone(withCheck, 1)).toBe(true);
  });

  it("passes over the conflict chain's Stages before Publish, and its Gate is never the check", () => {
    const resolving = flowOf([
      agentStage("write"),
      gate("look"),
      keptPublish({ afterConflict: "review" }),
    ]);
    const lookAt = resolving.findIndex(({ key }) => key === "look");
    const chainGateAt = resolving.findIndex(({ key }) => key === RESOLVE_GATE_KEY);

    expect(resolving.some(({ key }) => key === RESOLVE_KEY)).toBe(true);
    expect(gateChecksDefinitionOfDone(resolving, lookAt)).toBe(true);
    expect(gateChecksDefinitionOfDone(resolving, chainGateAt)).toBe(false);
  });

  it("is false with an Agent Stage or a later Gate before Publish, with no Publish after it, or for any other Stage", () => {
    const withReview = flowOf([gate("look"), agentStage("review"), publish]);
    expect(gateChecksDefinitionOfDone(withReview, 0)).toBe(false);
    expect(gateChecksDefinitionOfDone(flowOf([gate("look"), gate("again"), publish]), 0)).toBe(
      false,
    );
    expect(gateChecksDefinitionOfDone(flowOf([agentStage("write"), gate("look")]), 1)).toBe(false);
    expect(gateChecksDefinitionOfDone(flowOf([agentStage("write"), publish]), 0)).toBe(false);
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
