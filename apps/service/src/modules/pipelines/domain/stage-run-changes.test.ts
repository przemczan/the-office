import { describe, expect, it } from "vitest";
import { interruptedOutcome } from "./stage-interruption.js";
import {
  endStageRun,
  holdStageRun,
  keepAnswers,
  keepDecision,
  keepGateAction,
  keepRestart,
} from "./stage-run-changes.js";
import { aStageRun } from "./stage-run.fixtures.js";
import type { StageRunDecision } from "./stage-run.js";
import { walkDecisionId } from "./walk-decisions.js";

const ANN = { userId: "ann", name: "Ann Lee" };
const BEN = { userId: "ben", name: "Ben Ito" };
const running = aStageRun({ outcome: undefined, endedAt: undefined });
const NOW = new Date("2026-11-28T10:00:00Z");

describe("A Stage run's hold", () => {
  it("keeps the stronger of what was asked, whichever came first", () => {
    const paused = holdStageRun(running, "pause", ANN)?.run ?? running;
    const stopped = holdStageRun(paused, "stop", BEN)?.run;

    expect(stopped).toMatchObject({ heldBy: "stop", heldByUser: BEN });
    expect(stopped && holdStageRun(stopped, "pause", ANN)).toBeUndefined();
  });

  it("holds an ended run no more", () => {
    expect(holdStageRun(aStageRun(), "stop", BEN)).toBeUndefined();
  });

  it("ends held by a Stop its end honoured after a Pause was asked of it", () => {
    const paused = holdStageRun(running, "pause", ANN)?.run ?? running;

    const { run } = endStageRun(paused, interruptedOutcome("stop", [], { heldByUser: BEN }), NOW);

    expect(run).toMatchObject({ heldBy: "stop", heldByUser: BEN });
  });

  it("ends held by a Stop asked of it after its end honoured a Pause", () => {
    const stopped = holdStageRun(running, "stop", BEN)?.run ?? running;

    const { run } = endStageRun(stopped, interruptedOutcome("pause", [], { heldByUser: ANN }), NOW);

    expect(run).toMatchObject({ heldBy: "stop", heldByUser: BEN });
  });

  it("ends with no changed files when it saved none", () => {
    expect(
      endStageRun(running, { status: "done", summary: "Done." }, NOW).run.changedFiles,
    ).toEqual([]);
  });
});

describe("A Stage run's Decisions", () => {
  const asked: StageRunDecision = {
    id: "decision-1",
    kind: "route-limit",
    options: [{ kind: "drop" }],
    answer: undefined,
  };

  it("keeps a Decision once", () => {
    const kept = keepDecision(running, asked)?.run ?? running;

    expect(kept.decisions).toEqual([asked]);
    expect(keepDecision(kept, asked)).toBeUndefined();
  });

  it("takes the first answer of a Decision and leaves it as it is after", () => {
    const run = aStageRun({ decisions: [asked] });
    const answered = keepAnswers(run, new Map([["decision-1", { kind: "option", option: 0 }]]));

    expect(answered?.run.decisions).toEqual([{ ...asked, answer: { kind: "drop" } }]);
    const again = new Map([["decision-1", { kind: "free-answer", text: "Go on." } as const]]);
    expect(answered && keepAnswers(answered.run, again)).toBeUndefined();
  });

  it("names the walk's Decision of a kind on a run by one id each time it asks it", () => {
    const id = walkDecisionId("run-1", "route-limit");

    expect(walkDecisionId("run-1", "route-limit")).toBe(id);
    expect(walkDecisionId("run-1", "budget")).not.toBe(id);
    expect(walkDecisionId("run-2", "route-limit")).not.toBe(id);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("A Stage run's one-time records", () => {
  it("keeps one Gate action", () => {
    const continued = keepGateAction(running, { kind: "continue", byUser: ANN })?.run ?? running;

    expect(keepGateAction(continued, { kind: "drop", byUser: BEN })).toBeUndefined();
  });

  it("keeps a Restart from… on an ended run only, once", () => {
    const restart = { stageKey: "implement", feedback: undefined, byUser: ANN };

    expect(keepRestart(running, restart)).toBeUndefined();
    const restarted = keepRestart(aStageRun(), restart)?.run;
    expect(restarted?.restart).toEqual(restart);
    expect(restarted && keepRestart(restarted, restart)).toBeUndefined();
  });
});
