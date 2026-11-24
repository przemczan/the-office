import { describe, expect, it } from "vitest";
import { stageProblems } from "./pipeline.js";
import type { KeptStage } from "./routes-back.js";
import type { Stage } from "./stage.js";
import { agentStage, publishStage, scriptStage } from "./stage.fixtures.js";

function problemTexts(stages: readonly Stage[]): string[] {
  return stageProblems(stages).map((problem) => problem.text);
}

/** Implement, then Tests going back to `goBackTo` on failure at most `rounds` times, then Publish. */
function goingBack(goBackTo: string, rounds: number): KeptStage[] {
  return [agentStage(), { ...scriptStage(), onFailure: { goBackTo, rounds } }, publishStage()];
}

describe("stageProblems", () => {
  it("takes a Stage's own effort", () => {
    expect(stageProblems([agentStage({ effort: "low" })])).toEqual([]);
  });

  it("names the Stage each problem is on", () => {
    expect(stageProblems([agentStage(), agentStage({ key: "again", role: "" })])).toEqual([
      {
        stageKey: "again",
        at: { kind: "stage" },
        level: "problem",
        text: 'Stage 2 · Implement: another Stage is named "Implement".',
      },
      {
        stageKey: "again",
        at: { kind: "stage" },
        level: "problem",
        text: "Stage 2 · Implement: choose who works it.",
      },
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

  describe("a kept on-failure setting, read as its failure route", () => {
    it.each([
      ["an earlier Stage", "implement"],
      ["itself", "tests"],
      ["a later Stage, where its other route leads too", "publish"],
    ])("may go to %s", (_target, goBackTo) => {
      expect(stageProblems(goingBack(goBackTo, 1))).toEqual([]);
    });

    it("can't go to a Stage that doesn't exist", () => {
      expect(stageProblems(goingBack("nowhere", 1))).toEqual([
        {
          stageKey: "tests",
          at: { kind: "route", routeIndex: 0 },
          level: "problem",
          text: "Stage 2 · Tests: its route to nowhere leads to a Stage the Pipeline doesn't have.",
        },
      ]);
    });

    it.each([0, 2.5])("can't go back %s times", (rounds) => {
      expect(problemTexts(goingBack("implement", rounds))).toEqual([
        `Stage 2 · Tests: its route to Implement has a limit of ${rounds}; give it 1 to 9 times, or No limit.`,
      ]);
    });

    it("reads going back more than 9 times as at most 9, as a kept setting may", () => {
      expect(problemTexts(goingBack("implement", 10))).toEqual([]);
    });
  });
});
