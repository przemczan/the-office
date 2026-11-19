import type { Stage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  addStage,
  addStageFrom,
  canContinue,
  removeStage,
  withCommand,
  withDuty,
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
    const gate = addStage(quickFix, "gate");
    expect(gate.index).toBe(2);
    expect(keysOf(gate.stages)).toEqual(["implement", "tests", "gate", "publish"]);

    const second = addStage(gate.stages, "gate");
    expect(second.stages[3]).toEqual({
      kind: "gate",
      key: "gate-2",
      name: "Gate 2",
      optional: false,
    });

    const agent = addStage(quickFix, "agent");
    expect(agent.index).toBe(3);
    expect(agent.stages[3]).toMatchObject({
      kind: "agent",
      key: "new-stage",
      role: "",
      session: "fresh",
    });
  });

  it("adds a Stage template as a copy where its kind goes, with its own key and no failure rule", () => {
    const template = { id: "tests", stage: { ...tests, key: "tests", name: "Lint first" } };
    const added = addStageFrom(quickFix, template);
    expect(added.index).toBe(3);
    expect(added.stages[3]).toEqual({
      kind: "script",
      key: "lint-first",
      name: "Lint first",
      optional: false,
      command: "test",
    });

    const uiAcceptance: Stage = { kind: "gate", key: "ui", name: "UI acceptance", optional: false };
    expect(addStageFrom(quickFix, { id: "ui", stage: uiAcceptance }).index).toBe(2);
  });

  it("names a Stage template's copy apart from the Stages it joins", () => {
    const added = addStageFrom(quickFix, { id: "tests", stage: tests });
    expect(added.stages[3]).toMatchObject({ key: "tests-2", name: "Tests 2" });
    expect(added.stages[3]).not.toHaveProperty("onFailure");
  });

  it("drops a Stage with every failure rule that went back to it", () => {
    expect(removeStage(quickFix, 0)).toEqual([{ ...tests, onFailure: undefined }, publish]);
  });

  it("continues a session only after the same Role, and starts fresh once the Role changes", () => {
    const review: Stage = { ...implement, key: "review", name: "Review", session: "continue" };
    const stages = [implement, review];
    expect(canContinue(stages, 1)).toBe(true);
    expect(canContinue([tests, review], 1)).toBe(false);
    expect(withRole(stages, 1, "reviewer")).toMatchObject({ role: "reviewer", session: "fresh" });
    expect(withRole(stages, 1, "developer")).toMatchObject({ session: "continue" });
  });

  it("gives a Stage a Role or a duty, each clearing the other", () => {
    const toDuty = withDuty([implement], 0, "implements");
    expect(toDuty).toMatchObject({ duty: "implements" });
    expect(toDuty).not.toHaveProperty("role");
    const backToRole = withRole([toDuty], 0, "developer");
    expect(backToRole).toMatchObject({ role: "developer" });
    expect(backToRole).not.toHaveProperty("duty");
  });

  it("continues a session only after the same duty, a Role working it being another", () => {
    const planning: Stage = {
      ...implement,
      key: "plan",
      name: "Plan",
      role: undefined,
      duty: "plans",
    };
    const review: Stage = { ...planning, key: "review", name: "Review", session: "continue" };
    expect(canContinue([planning, review], 1)).toBe(true);
    expect(canContinue([implement, review], 1)).toBe(false);
    expect(withDuty([planning, review], 1, "reviews")).toMatchObject({
      duty: "reviews",
      session: "fresh",
    });
    expect(withDuty([planning, review], 1, "plans")).toMatchObject({ session: "continue" });
    expect(withRole([planning, review], 1, "developer")).toMatchObject({ session: "fresh" });
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
