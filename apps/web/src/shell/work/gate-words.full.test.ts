import type { Stage, StageRun, TaskStage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  continueLabel,
  continueNotesPlaceholder,
  defaultSendBackTarget,
  sendBackWords,
  waitingGateOf,
} from "./gate-words.ts";
import { NO_TOKENS } from "../token-words.ts";

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
    waitingSince: null,
    threadId: null,
    session: null,
    engine: null,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    context: null,
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
  return { stage, state, tokens: NO_TOKENS, wentBack: null, runs: [aRun(gateAction)] };
}

describe("waitingGateOf", () => {
  it("is the Gate the Task waits at, with the Stage after it and the Stages it may send back to", () => {
    const firstLook: Stage = { ...look, key: "first-look", name: "First look" };
    const earlyPublish: Stage = { ...publish, key: "early-publish" };
    const waiting = waitingGateOf([
      at(implement, "done"),
      at(tests, "done"),
      at(firstLook, "done", { kind: "continue" }),
      at(earlyPublish, "done"),
      at(review, "skipped"),
      at(look, "waiting-on-you"),
      at(publish, "pending"),
    ]);

    expect(waiting?.gate).toBe(look);
    expect(waiting?.next).toBe(publish);
    // Neither a Gate, which would only wait again, nor a Publish, whose work has left.
    expect(waiting?.sendBackTargets).toEqual([implement, tests, review]);
    expect(waiting?.earlier.map(({ stage }) => stage.key)).toEqual([
      "implement",
      "tests",
      "first-look",
      "early-publish",
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

  it("names the first Agent Stage after the Gate, which notes reach, or none when no Agent Stage follows", () => {
    const beforeReview = waitingGateOf([
      at(implement, "done"),
      at(look, "waiting-on-you"),
      at(tests, "pending"),
      at(review, "pending"),
    ]);
    const beforePublish = waitingGateOf([
      at(implement, "done"),
      at(look, "waiting-on-you"),
      at(publish, "pending"),
    ]);

    expect(beforeReview?.nextAgentStage).toBe(review);
    expect(beforePublish?.nextAgentStage).toBeUndefined();
    expect(continueNotesPlaceholder("Jim")).toBe("What should Jim know as the work goes on?");
  });
});

describe("the send-back chooser", () => {
  it("starts at the last Agent Stage, or the last Stage when no Agent works one", () => {
    expect(defaultSendBackTarget([implement, review, tests])).toBe(review);
    expect(defaultSendBackTarget([tests])).toBe(tests);
    expect(defaultSendBackTarget([])).toBeUndefined();
  });

  it("asks the Agent what to change, and tells a Script Stage just runs again", () => {
    expect(sendBackWords(implement, "Adam")).toEqual({
      placeholder: "What should Adam change?",
      sent: "Sent back to Adam.",
    });
    expect(sendBackWords(tests, "the Agent")).toEqual({
      placeholder: "What should change? Tests runs again; your feedback stays on its run.",
      sent: "Sent back to Tests: it runs again.",
      scriptNote: "Tests is a script: it can't read your feedback, it only runs again.",
    });
  });
});
