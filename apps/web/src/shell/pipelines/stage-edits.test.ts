import type { Stage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  addStage,
  canContinue,
  canMove,
  failureTargets,
  moveStage,
  removeStage,
  withCommand,
  withRole,
  type ScriptStage,
} from "./stage-edits.ts";

const implement: Stage = {
  kind: "agent",
  key: "implement",
  name: "Implement",
  optional: false,
  role: "developer",
  brief: "Implement the Plan.",
  session: "fresh",
  budget: 250_000,
};
const tests: Stage = {
  kind: "script",
  key: "tests",
  name: "Tests",
  optional: false,
  command: "test",
  onFailure: { goBackTo: "implement", rounds: 3 },
};
const publish: Stage = {
  kind: "script",
  key: "publish",
  name: "Publish",
  optional: false,
  command: "publish",
};
const quickFix: readonly Stage[] = [implement, tests, publish];

const keysOf = (stages: readonly Stage[]): string[] => stages.map(({ key }) => key);

describe("the Stage editor's changes", () => {
  it("adds a Gate before the last Stage and anything else at the end, each with its own key and name", () => {
    const gate = addStage(quickFix, "gate", 0);
    expect(gate.index).toBe(2);
    expect(keysOf(gate.stages)).toEqual(["implement", "tests", "gate", "publish"]);

    const second = addStage(gate.stages, "gate", 0);
    expect(second.stages[3]).toEqual({
      kind: "gate",
      key: "gate-2",
      name: "Gate 2",
      optional: false,
    });

    const agent = addStage(quickFix, "agent", 0);
    expect(agent.index).toBe(3);
    expect(agent.stages[3]).toMatchObject({
      kind: "agent",
      key: "new-stage",
      role: "",
      session: "fresh",
    });
  });

  it("adds a Gate at the end once every Stage has started", () => {
    expect(addStage(quickFix, "gate", 3).index).toBe(3);
  });

  it("drops a Stage with every failure rule that went back to it", () => {
    expect(removeStage(quickFix, 0)).toEqual([{ ...tests, onFailure: undefined }, publish]);
  });

  it("moves a Stage only among those that haven't started", () => {
    expect(keysOf(moveStage(quickFix, 2, -1, 0))).toEqual(["implement", "publish", "tests"]);
    expect(canMove(quickFix, 1, -1, 1)).toBe(false);
    expect(canMove(quickFix, 0, 1, 1)).toBe(false);
    expect(canMove(quickFix, 2, 1, 0)).toBe(false);
    expect(moveStage(quickFix, 1, -1, 1)).toBe(quickFix);
  });

  it("continues a session only after the same Role, and starts fresh once the Role changes", () => {
    const review: Stage = { ...implement, key: "review", name: "Review", session: "continue" };
    const stages = [implement, review];
    expect(canContinue(stages, 1)).toBe(true);
    expect(canContinue([tests, review], 1)).toBe(false);
    expect(withRole(stages, 1, "reviewer")).toMatchObject({ role: "reviewer", session: "fresh" });
    expect(withRole(stages, 1, "developer")).toMatchObject({ session: "continue" });
  });

  it("goes back on failure only to earlier Stages that aren't Gates", () => {
    const gated = addStage(quickFix, "gate", 0).stages;
    expect(keysOf(failureTargets(gated, 3))).toEqual(["implement", "tests"]);
    expect(failureTargets(gated, 0)).toEqual([]);
  });
});

describe("withCommand", () => {
  const pushingTheBranch: ScriptStage = {
    kind: "script",
    key: "publish",
    name: "Publish",
    optional: false,
    command: "publish",
    publishTarget: "branch-only",
    afterConflict: "review",
  };

  it("keeps what a Publish Stage alone says while it publishes, and drops it for another command", () => {
    expect(withCommand(pushingTheBranch, "publish")).toEqual(pushingTheBranch);
    const {
      publishTarget: _droppedTarget,
      afterConflict: _droppedConflict,
      ...commandStage
    } = pushingTheBranch;
    expect(withCommand(pushingTheBranch, "test")).toEqual({ ...commandStage, command: "test" });
  });
});
