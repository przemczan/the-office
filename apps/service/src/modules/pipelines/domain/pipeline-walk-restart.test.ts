import { describe, expect, it } from "vitest";
import { reportedMet } from "./definition-of-done-reports.js";
import { asFlow } from "./flow.js";
import { nextMove, routeCounts } from "./pipeline-walk.js";
import type { KeptStage } from "./routes-back.js";
import type { Stage } from "./stage.js";
import { stagesProgress } from "./stage-progress.js";
import type { HoldingUser, StageOutcome, StageRun, TaskRestart } from "./stage-run.js";
import { aStageRun } from "./stage-run.fixtures.js";
import {
  isOfEarlierStart,
  runsOfLatestStart,
  startOverRecord,
  workLeftTheWorkstation,
} from "./start-over.js";

const ANN: HoldingUser = { userId: "user-ann", name: "Ann Lee" };

function agentStage(key: string, onFailure?: KeptStage["onFailure"]): KeptStage {
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

function scriptStage(key: string): Stage {
  return { kind: "script", key, name: key, optional: false, command: "test" };
}

const publish: Stage = { kind: "publish", key: "publish", name: "Publish", optional: false };

/** Write, Review (going back to Write once when it fails), Test, then Publish. */
const stages: readonly Stage[] = [
  agentStage("write"),
  agentStage("review", { goBackTo: "write", rounds: 1 }),
  scriptStage("test"),
  publish,
];

const done: StageOutcome = { status: "done", summary: "Done." };
const paused: StageOutcome = {
  status: "failed",
  error: "Paused by the user Ann Lee.",
  interrupted: "pause",
  heldByUser: ANN,
};

/** The runs of these Stages in order, each a `[stageKey, outcome, fields]`. */
function runs(
  ...ran: readonly (readonly [string, StageOutcome | undefined, Partial<StageRun>?])[]
): StageRun[] {
  return ran.map(([stageKey, outcome, fields], index) =>
    aStageRun({ number: index + 1, stageKey, outcome, ...fields }),
  );
}

function restartFrom(stageKey: string, feedback?: string): Partial<StageRun> {
  const restart: TaskRestart = { stageKey, feedback, byUser: ANN };
  return { restart };
}

describe("Restart from… in the walk", () => {
  it("runs an earlier Stage next, with the feedback and who restarted it", () => {
    const ran = runs(["write", done], ["review", paused, restartFrom("write", "Use the hook.")]);

    expect(nextMove(stages, ran, [])).toEqual({
      move: "run",
      stage: stages[0],
      carriedFailure: undefined,
      sentBack: undefined,
      restarted: { feedback: "Use the hook.", byUser: ANN },
    });
  });

  it("runs a later Stage next and goes on from it by its routes", () => {
    const ran = runs(["write", paused, restartFrom("test")]);

    expect(nextMove(stages, ran, [])).toMatchObject({
      move: "run",
      stage: { key: "test" },
      restarted: { feedback: undefined, byUser: ANN },
    });
    const after = runs(["write", paused, restartFrom("test")], ["test", done]);
    expect(nextMove(stages, after, [])).toMatchObject({ move: "run", stage: { key: "publish" } });
  });

  it("restarts from a Gate's run waiting on the user, or a run whose Agent's Decision waits", () => {
    const gated: readonly Stage[] = [
      agentStage("write"),
      { kind: "gate", key: "check", name: "Check", optional: false },
      publish,
    ];
    const ran = runs(["write", done], ["check", done, restartFrom("write")]);
    expect(nextMove(gated, ran, [])).toMatchObject({ move: "run", stage: { key: "write" } });

    const asking = runs([
      "write",
      paused,
      {
        ...restartFrom("write"),
        decisions: [
          { id: "d-1", kind: "agent", question: "Which?", options: [], answer: undefined },
        ],
      },
    ]);
    expect(nextMove(stages, asking, [])).toMatchObject({ move: "run", stage: { key: "write" } });
  });

  it("uses none of a route's times", () => {
    const failed: StageOutcome = { status: "failed", error: "Broken." };
    const ran = runs(
      ["write", done],
      ["review", paused, restartFrom("write")],
      ["write", done],
      ["review", failed],
    );
    const flow = asFlow(stages);
    const review = flow.find(({ key }) => key === "review");
    if (!review) throw new Error("No review.");

    expect(routeCounts(stages, ran.slice(0, 2), "review", review.routes)[0]).toMatchObject({
      times: 0,
    });
    // The failure route back still has its one time: the walk follows it.
    expect(nextMove(stages, ran, [])).toMatchObject({
      move: "run",
      stage: { key: "write" },
      carriedFailure: { stageKey: "review", round: 1, rounds: 1 },
    });
  });

  it("still checks the Definition of Done before a Publish it restarts at", () => {
    const ran = runs(["write", paused, restartFrom("publish")]);

    expect(nextMove(stages, ran, ["The name shows"])).toMatchObject({
      move: "ask",
      question: { kind: "definition-of-done", unmet: ["The name shows"] },
    });
    expect(nextMove(stages, ran, [])).toMatchObject({ move: "run", stage: { key: "publish" } });
  });

  it("shows the Stages a restart jumped over as Skipped, and the held run's Stage as stopped", () => {
    const flow = asFlow(stages);
    const ran = runs(["write", paused, restartFrom("test")]);

    expect(stagesProgress(flow, ran).map(({ stage, state }) => [stage.key, state])).toEqual([
      ["write", "stopped"],
      ["review", "skipped"],
      ["test", "pending"],
      ["publish", "pending"],
    ]);
    const back = runs(["write", done], ["review", paused, restartFrom("write")], ["write", done]);
    expect(stagesProgress(flow, back).map(({ state }) => state)).toEqual([
      "done",
      "stopped",
      "pending",
      "pending",
    ]);
  });
});

describe("Start over in the walk", () => {
  const over = startOverRecord(1, ANN, new Date("2026-11-20T10:00:00Z"), {
    resetTo: "main",
    keptRef: "refs/office/started-over/task-1/1",
  });

  it("walks from the first Stage again, the runs before it history only", () => {
    const ran = runs(
      ["write", { ...done, definitionOfDoneMet: [1] }],
      ["review", paused, { startedOver: over }],
    );

    expect(runsOfLatestStart(ran)).toEqual([]);
    expect(nextMove(stages, ran, ["The name shows"])).toEqual({
      move: "run",
      stage: stages[0],
      carriedFailure: undefined,
      sentBack: undefined,
    });
    expect(reportedMet(runsOfLatestStart(ran))).toEqual([]);
    expect(isOfEarlierStart(ran[0] as StageRun, ran)).toBe(true);
  });

  it("counts a route's times only since the latest Start over", () => {
    const failed: StageOutcome = { status: "failed", error: "Broken." };
    const ran = runs(
      ["write", done],
      ["review", failed],
      ["write", done],
      ["review", paused, { startedOver: over }],
      ["write", done],
      ["review", failed],
    );

    // Before the Start over, the route back was used up; after it, it has its time again.
    expect(nextMove(stages, ran, [])).toMatchObject({
      move: "run",
      stage: { key: "write" },
      carriedFailure: { round: 1, rounds: 1 },
    });
    const progress = stagesProgress(asFlow(stages), ran);
    expect(progress[0]?.runs.map(({ number }) => number)).toEqual([1, 3, 5]);
    expect([...(progress[0]?.earlierStart ?? [])]).toEqual(["run-1", "run-3"]);
    expect(progress[1]?.state).toBe("failed");
    expect(progress[2]?.state).toBe("pending");
  });

  it("knows a Task whose Publish shipped its work", () => {
    const shipped = runs(
      ["write", done],
      ["publish", { status: "done", summary: "Merged.", publishResult: "published" }],
    );
    const nothing = runs(
      ["write", done],
      ["publish", { status: "done", summary: "Nothing.", publishResult: "nothing-to-publish" }],
    );

    expect(workLeftTheWorkstation(stages, shipped)).toBe(true);
    expect(workLeftTheWorkstation(stages, nothing)).toBe(false);
    expect(workLeftTheWorkstation(stages, runs(["write", done]))).toBe(false);
  });
});
