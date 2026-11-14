import { describe, expect, it } from "vitest";
import { stageProblems } from "./pipeline.js";
import type { Stage } from "./stage.js";
import { agentStage, dutyStage, gate, scriptStage } from "./stage.fixtures.js";

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

  it("takes a Publish Stage's target, and refuses one on another Script Stage", () => {
    const publish = scriptStage({ key: "publish", name: "Publish", command: "publish" });

    expect(stageProblems([{ ...publish, publishTarget: "branch-only" }])).toEqual([]);
    expect(stageProblems([{ ...publish, publishTarget: "publishing-mode" }])).toEqual([]);
    expect(problemTexts([scriptStage({ publishTarget: "branch-only" })])).toEqual([
      "Stage 1 · Tests: only a Publish Stage has a publish target.",
    ]);
  });

  it("refuses a Pipeline with no Stages", () => {
    expect(stageProblems([])).toEqual([{ text: "A Pipeline needs at least one Stage." }]);
  });

  it("refuses two Stages with the same key, and a Stage with no name", () => {
    expect(problemTexts([agentStage(), scriptStage({ key: "implement", name: " " })])).toEqual([
      'Stage 2 · implement: another Stage has the key "implement".',
      "Stage 2 · implement: give it a name.",
    ]);
  });

  describe("continuing a session", () => {
    const continuing = agentStage({ key: "review", name: "Review", session: "continue" });

    it.each<[string, Stage[]]>([
      ["first", [continuing]],
      ["after a Script Stage", [agentStage(), scriptStage(), continuing]],
      ["after another Role", [agentStage({ role: "reviewer" }), continuing]],
      ["after a duty", [dutyStage("implements"), continuing]],
      [
        "naming a duty after another duty",
        [
          dutyStage("plans"),
          dutyStage("implements", { key: "review", name: "Review", session: "continue" }),
        ],
      ],
    ])("is refused %s", (_where, stages) => {
      expect(problemTexts(stages)).toEqual([
        `Stage ${stages.length} · Review: continuing a session needs the same Role or the same duty in the Stage before.`,
      ]);
    });

    it("passes after a Stage naming the same duty, whoever holds it", () => {
      const reviewing = dutyStage("implements", {
        key: "review",
        name: "Review",
        session: "continue",
      });

      expect(stageProblems([dutyStage("implements"), reviewing])).toEqual([]);
    });
  });

  describe("who works an Agent Stage", () => {
    it("passes a Stage naming a duty instead of a Role", () => {
      expect(stageProblems([dutyStage("implements")])).toEqual([]);
    });

    it("refuses a Stage naming both a Role and a duty", () => {
      expect(problemTexts([agentStage({ duty: "implements" })])).toEqual([
        "Stage 1 · Implement: name a Role or a duty, not both.",
      ]);
    });

    it("refuses a Stage naming neither", () => {
      expect(problemTexts([agentStage({ role: "" })])).toEqual([
        "Stage 1 · Implement: choose who works it.",
      ]);
      expect(problemTexts([dutyStage("implements", { duty: undefined })])).toEqual([
        "Stage 1 · Implement: choose who works it.",
      ]);
    });
  });
});
