import { describe, expect, it } from "vitest";
import { agentStage, gate, publishStage } from "./stage.fixtures.js";
import { GATE_REACHED } from "./gate.js";
import type { GateAction, StageOutcome } from "./stage-run.js";
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

const REFUSED = {
  message: "work",
  sessionLeft: false,
  engineName: "Claude Code",
  windowWords: "5-hour window",
  resetsAt: "2026-11-13T14:00:00.000Z",
} as const;

describe("a Stand-in Engine in the Stage history (spec 5.4)", () => {
  it("names each switch of the run's session, with the window and its reset", () => {
    const run = aStageRun({
      outcome: { status: "done", summary: "Added the dialog." },
      engineSwitches: [
        {
          fromEngineId: "claude-code",
          fromEngineName: "Claude Code",
          toEngineId: "claude-code-2",
          toEngineName: "Claude Code 2",
          windowWords: "5-hour window",
          resetsAt: "2026-11-13T14:00:00.000Z",
          at: "2026-11-13T12:00:00.000Z",
        },
      ],
    });

    expect(stageRunWords(stages, run, [], undefined)).toContain(
      "Engine switch: Claude Code's 5-hour window was used up until 2026-11-13 14:00 UTC, so the Stage went on on Claude Code 2.",
    );
  });

  it("says a held run waits for the user's choice of a Stand-in Engine, as its context is large", () => {
    const run = aStageRun({
      outcome: {
        status: "failed",
        error: "Paused.",
        interrupted: "usage-window",
        refused: {
          ...REFUSED,
          standInChoice: {
            engineId: "claude-code-2",
            engineName: "Claude Code 2",
            contextTokens: 182_000,
            askAbove: 100_000,
          },
        },
      },
    });

    expect(stageRunWords(stages, run, [], undefined)).toContain(
      "its context of 182,000 tokens is over the 100,000 set in Settings › Engines, so it waits for the user's choice to go on on Claude Code 2, or the reset",
    );
  });

  it("names no choice for a run held with none", () => {
    const run = aStageRun({
      outcome: {
        status: "failed",
        error: "Paused.",
        interrupted: "usage-window",
        refused: REFUSED,
      },
    });

    const words = stageRunWords(stages, run, [], undefined);
    expect(words).toContain("the engine refused the Stage's work");
    expect(words).not.toContain("Settings › Engines");
    expect(words).not.toContain("Engine switch");
  });
});

describe("a Publish Stage's result in the Stage history", () => {
  const publish = publishStage();

  function resultOf(outcome: StageOutcome, stageKey = "publish"): string[] {
    const words = stageRunWords(
      [implement, publish],
      aStageRun({ stageKey, outcome }),
      [],
      undefined,
    );
    return words.split("\n").filter((line) => line.startsWith("Result: "));
  }

  it("names the pull request a Published run opened", () => {
    expect(
      resultOf({
        status: "done",
        summary: "Pushed it.",
        pullRequestUrl: "https://github.com/notnullsoft/admin/pull/212",
        publishResult: "published",
      }),
    ).toEqual(["Result: Published: pull request #212 opened."]);
    expect(resultOf({ status: "done", summary: "Merged.", publishResult: "published" })).toEqual([
      "Result: Published.",
    ]);
  });

  it("counts a Conflict's files, read from a run kept before results were", () => {
    expect(
      resultOf({
        status: "failed",
        error: "The branch conflicts.",
        baseMoved: { conflictedFiles: ["a.ts", "b.ts", "c.ts"] },
      }),
    ).toEqual(["Result: Conflict with the base branch in 3 files."]);
  });

  it("names the other results, and a run kept of a Publish Stage the Task no longer has", () => {
    expect(
      resultOf({
        status: "done",
        summary: "Nothing.",
        publishResult: "nothing-to-publish",
      }),
    ).toEqual(["Result: Nothing to publish."]);
    expect(
      resultOf({ status: "failed", error: "Refused.", publishResult: "failed" }, "gone"),
    ).toEqual(["Result: Failed."]);
  });

  it("gives no result for another Stage's run", () => {
    expect(resultOf({ status: "done", summary: "Done." }, "implement")).toEqual([]);
  });
});
