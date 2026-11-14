import { describe, expect, it } from "vitest";
import { agentStage, gate } from "./stage.fixtures.js";
import { GATE_REACHED } from "./gate.js";
import type { GateAction } from "./stage-run.js";
import { aStageRun } from "./stage-run.fixtures.js";
import { stageRunWords } from "./stage-history-words.js";

const implement = agentStage();
const review = gate({ key: "review", name: "Review" });
const stages = [implement, review];
const ann = { userId: "00000000-0000-4000-8000-0000000005e1", name: "Ann Lee" };

function wordsOf(gateAction: GateAction): string {
  const run = aStageRun({ stageKey: "review", outcome: GATE_REACHED, gateAction });
  return stageRunWords(stages, run, [], undefined);
}

describe("a Gate action in the Stage history", () => {
  it("names the user who acted at the Gate", () => {
    expect(wordsOf({ kind: "continue", byUser: ann })).toContain(
      "At the Gate the user Ann Lee let the work continue.",
    );
    expect(
      wordsOf({ kind: "send-back", stageKey: "implement", feedback: "Again.", byUser: ann }),
    ).toContain(`At the Gate the user Ann Lee sent the work back to "Implement": Again.`);
    expect(wordsOf({ kind: "drop", byUser: ann })).toContain(
      "At the Gate the user Ann Lee dropped the Task.",
    );
  });

  it("reads as the user for an action kept before users existed", () => {
    expect(wordsOf({ kind: "drop" })).toContain("At the Gate the user dropped the Task.");
  });
});
