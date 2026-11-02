import { describe, expect, it } from "vitest";
import { GATE_REACHED, gateActionProblems, sendBackTargets, waitingGateRun } from "./gate.js";
import type { Stage } from "./stage.js";
import { NO_STAGE_TOKENS, type GateAction, type StageRun } from "./stage-run.js";

function agentStage(key: string): Stage {
  return {
    kind: "agent",
    key,
    name: key,
    optional: false,
    role: "developer",
    brief: "Do it.",
    session: "fresh",
    budget: 100_000,
  };
}

const stages: readonly Stage[] = [
  agentStage("implement"),
  { kind: "script", key: "tests", name: "Tests", optional: false, command: "test" },
  { kind: "gate", key: "first-look", name: "First look", optional: false },
  agentStage("review"),
  { kind: "script", key: "publish", name: "Publish", optional: false, command: "publish" },
  { kind: "gate", key: "look", name: "Look", optional: false },
  agentStage("document"),
];

function aRun(stageKey: string, gateAction?: GateAction): StageRun {
  return {
    id: `run-${stageKey}`,
    taskId: "task-1",
    stageKey,
    number: 1,
    carriedFailure: undefined,
    sentBack: undefined,
    threadId: undefined,
    session: undefined,
    headCommit: undefined,
    commandRuns: [],
    tokens: NO_STAGE_TOKENS,
    engine: undefined,
    model: undefined,
    usageWindowsAtStart: [],
    usageWindowsAtEnd: undefined,
    decisions: [],
    heldBy: undefined,
    gateAction,
    outcome: GATE_REACHED,
    startedAt: new Date(0),
    endedAt: new Date(0),
  };
}

const sendBack = (stageKey: string, feedback = "Name it Save."): GateAction => ({
  kind: "send-back",
  stageKey,
  feedback,
});

describe("sendBackTargets", () => {
  it("is every Stage before the Gate but a Gate and a Publish", () => {
    expect(sendBackTargets(stages, "look").map(({ key }) => key)).toEqual([
      "implement",
      "tests",
      "review",
    ]);
  });
});

describe("waitingGateRun", () => {
  it("is the latest run while it is a Gate's the user hasn't acted at", () => {
    expect(waitingGateRun(stages, [aRun("look")])?.stageKey).toBe("look");
    expect(waitingGateRun(stages, [aRun("look", { kind: "continue" })])).toBeUndefined();
    expect(waitingGateRun(stages, [aRun("look"), aRun("document")])).toBeUndefined();
    expect(waitingGateRun(stages, [])).toBeUndefined();
  });
});

describe("gateActionProblems", () => {
  it("allows Continue, Drop, and Send back to an earlier Agent or Script Stage with feedback", () => {
    const waiting = [aRun("look")];

    expect(gateActionProblems(stages, waiting, { kind: "continue" })).toEqual([]);
    expect(gateActionProblems(stages, waiting, { kind: "drop" })).toEqual([]);
    expect(gateActionProblems(stages, waiting, sendBack("review"))).toEqual([]);
    expect(gateActionProblems(stages, waiting, sendBack("tests"))).toEqual([]);
  });

  it("refuses a Publish, a Gate, a later Stage and no feedback, and any action where no Gate waits", () => {
    const waiting = [aRun("look")];
    const target = "Send the work back to a Stage before the Gate, other than a Gate or a Publish.";

    expect(gateActionProblems(stages, waiting, sendBack("publish", " "))).toEqual([
      target,
      "Say what should change before sending it back.",
    ]);
    expect(gateActionProblems(stages, waiting, sendBack("first-look"))).toEqual([target]);
    expect(gateActionProblems(stages, waiting, sendBack("document"))).toEqual([target]);
    expect(gateActionProblems(stages, [aRun("implement")], { kind: "continue" })).toEqual([
      "The Task isn't waiting at a Gate.",
    ]);
  });
});
