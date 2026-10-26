import { describe, expect, it } from "vitest";
import { stageProblems } from "./pipeline.js";
import type { AgentStage, Gate, ScriptStage, Stage } from "./stage.js";

function agentStage(fields: Partial<AgentStage> = {}): AgentStage {
  return {
    kind: "agent",
    key: "implement",
    name: "Implement",
    role: "developer",
    brief: "Implement the Plan.",
    session: "fresh",
    budget: 100_000,
    optional: false,
    ...fields,
  };
}

function scriptStage(fields: Partial<ScriptStage> = {}): ScriptStage {
  return {
    kind: "script",
    key: "tests",
    name: "Tests",
    command: "test",
    optional: false,
    ...fields,
  };
}

function gate(fields: Partial<Gate> = {}): Gate {
  return { kind: "gate", key: "gate", name: "Gate", optional: false, ...fields };
}

function problemTexts(stages: readonly Stage[]): string[] {
  return stageProblems(stages).map((problem) => problem.text);
}

describe("stageProblems", () => {
  it("passes a straight list of Agent, Script and Gate Stages", () => {
    const stages = [
      agentStage(),
      scriptStage({ onFailure: { goBackTo: "implement", rounds: 3 } }),
      gate(),
      scriptStage({ key: "publish", name: "Publish", command: "publish", optional: false }),
    ];

    expect(stageProblems(stages)).toEqual([]);
  });

  it("refuses a Pipeline with no Stages", () => {
    expect(stageProblems([])).toEqual([{ text: "A Pipeline needs at least one Stage." }]);
  });

  it("names the Stage each problem is on", () => {
    expect(stageProblems([agentStage(), agentStage({ key: "again", role: "" })])).toEqual([
      { stageIndex: 1, text: 'Stage 2 · Implement: another Stage is named "Implement".' },
      { stageIndex: 1, text: "Stage 2 · Implement: choose who works it." },
    ]);
  });

  it("refuses two Stages with the same key, and a Stage with no name", () => {
    expect(problemTexts([agentStage(), scriptStage({ key: "implement", name: " " })])).toEqual([
      'Stage 2 · implement: another Stage has the key "implement".',
      "Stage 2 · implement: give it a name.",
    ]);
  });

  it.each([0, -1, 1.5, Number.NaN])("refuses an Agent Stage budget of %s tokens", (budget) => {
    expect(problemTexts([agentStage({ budget })])).toEqual([
      "Stage 1 · Implement: its budget must be a whole number of tokens above 0.",
    ]);
  });

  describe("continuing a session", () => {
    const continuing = agentStage({ key: "review", name: "Review", session: "continue" });

    it("is allowed after an Agent Stage of the same Role", () => {
      expect(stageProblems([agentStage(), continuing])).toEqual([]);
    });

    it.each<[string, Stage[]]>([
      ["first", [continuing]],
      ["after a Script Stage", [agentStage(), scriptStage(), continuing]],
      ["after another Role", [agentStage({ role: "reviewer" }), continuing]],
    ])("is refused %s", (_where, stages) => {
      expect(problemTexts(stages)).toEqual([
        `Stage ${stages.length} · Review: continuing a session needs the same Role in the Stage before.`,
      ]);
    });
  });

  describe("on failure", () => {
    it.each([
      ["a later Stage", "publish"],
      ["itself", "tests"],
      ["a Stage that doesn't exist", "nowhere"],
    ])("can't go back to %s", (_target, goBackTo) => {
      const stages = [
        agentStage(),
        scriptStage({ onFailure: { goBackTo, rounds: 1 } }),
        scriptStage({ key: "publish", name: "Publish", command: "publish" }),
      ];

      expect(problemTexts(stages)).toEqual([
        "Stage 2 · Tests: on failure it can only go back to an earlier Stage.",
      ]);
    });

    it("can't go back to a Gate", () => {
      const stages = [
        agentStage(),
        gate(),
        scriptStage({ onFailure: { goBackTo: "gate", rounds: 1 } }),
      ];

      expect(problemTexts(stages)).toEqual([
        "Stage 3 · Tests: on failure it can't go back to a Gate.",
      ]);
    });

    it.each([0, 2.5])("can't go back %s times", (rounds) => {
      const stages = [agentStage(), scriptStage({ onFailure: { goBackTo: "implement", rounds } })];

      expect(problemTexts(stages)).toEqual([
        "Stage 2 · Tests: on failure it must go back a whole number of times, at least once.",
      ]);
    });
  });
});
