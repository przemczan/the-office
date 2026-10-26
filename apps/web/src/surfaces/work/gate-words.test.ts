import type { Stage, StageRun, TaskStage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { continueLabel, waitingGateOf } from "./gate-words.ts";

function agentStage(key: string, name: string): Stage {
  return {
    kind: "agent",
    key,
    name,
    optional: false,
    role: "developer",
    brief: "Do it.",
    session: "fresh",
    budget: 100_000,
  };
}

const implement = agentStage("implement", "Implement");
const tests: Stage = {
  kind: "script",
  key: "tests",
  name: "Tests",
  optional: false,
  command: "test",
};
const review = agentStage("review", "Review & fix");
const look: Stage = { kind: "gate", key: "look", name: "UI acceptance", optional: false };
const publish: Stage = {
  kind: "script",
  key: "publish",
  name: "Publish",
  optional: false,
  command: "publish",
};

function aRun(gateAction: StageRun["gateAction"]): StageRun {
  return {
    id: "8f0b1a52-3c1e-4a4e-9d0e-1f5b6c7d8e9f",
    number: 1,
    startedAt: "2026-10-26T10:00:00.000Z",
    endedAt: "2026-10-26T10:00:00.000Z",
    threadId: null,
    session: null,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    carriedFailure: null,
    sentBack: null,
    commandRuns: [],
    gateAction,
    outcome: null,
  };
}

/** The Stage in `state`, its one run with `gateAction`: none acted on by default. */
function at(
  stage: Stage,
  state: TaskStage["state"],
  gateAction: StageRun["gateAction"] = null,
): TaskStage {
  return { stage, state, tokens: 0, wentBack: null, runs: [aRun(gateAction)] };
}

describe("waitingGateOf", () => {
  it("is the Gate the Task waits at, with the Stage after it and the Agent Stages before it", () => {
    const waiting = waitingGateOf([
      at(implement, "done"),
      at(tests, "done"),
      at(review, "skipped"),
      at(look, "waiting-on-you"),
      at(publish, "pending"),
    ]);

    expect(waiting?.gate).toBe(look);
    expect(waiting?.next).toBe(publish);
    expect(waiting?.sendBackTargets).toEqual([implement, review]);
    expect(waiting?.earlier.map(({ stage }) => stage.key)).toEqual([
      "implement",
      "tests",
      "review",
    ]);
    expect(waiting && continueLabel(waiting)).toBe("Continue to Publish");
  });

  it("is undefined for a Gate acted on whose run waits on a Decision", () => {
    expect(
      waitingGateOf([at(implement, "done"), at(look, "waiting-on-you", { kind: "continue" })]),
    ).toBeUndefined();
  });

  it("is undefined while no Gate waits, and Continue names nothing after the last Stage", () => {
    expect(waitingGateOf([at(implement, "running"), at(look, "pending")])).toBeUndefined();
    const last = waitingGateOf([at(implement, "done"), at(look, "waiting-on-you")]);
    expect(last && continueLabel(last)).toBe("Continue");
  });
});
