import { describe, expect, it } from "vitest";
import { stageProblems } from "./pipeline.js";
import type { Stage } from "./stage.js";
import { agentStage, gate, scriptStage } from "./stage.fixtures.js";

function problemTexts(stages: readonly Stage[]): string[] {
  return stageProblems(stages).map((problem) => problem.text);
}

describe("stageProblems", () => {
  it("takes what follows a conflict on a Publish Stage, and refuses it on another Script Stage", () => {
    const publish = scriptStage({ key: "publish", name: "Publish", command: "publish" });

    expect(stageProblems([{ ...publish, afterConflict: "review" }])).toEqual([]);
    expect(problemTexts([scriptStage({ afterConflict: "review" })])).toEqual([
      "Stage 1 · Tests: only a Publish Stage says what follows a conflict.",
    ]);
  });

  it("takes a Stage's own effort", () => {
    expect(stageProblems([agentStage({ effort: "low" })])).toEqual([]);
  });

  it("names the Stage each problem is on", () => {
    expect(stageProblems([agentStage(), agentStage({ key: "again", role: "" })])).toEqual([
      { stageIndex: 1, text: 'Stage 2 · Implement: another Stage is named "Implement".' },
      { stageIndex: 1, text: "Stage 2 · Implement: choose who works it." },
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
