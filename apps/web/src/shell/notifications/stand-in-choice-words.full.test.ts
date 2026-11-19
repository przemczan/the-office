import type { StandInChoice } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { momentWords } from "../time.ts";
import {
  contextSizeWords,
  ranOutWords,
  shownChoices,
  standInContextLine,
  standInWords,
  waitsForResetWords,
  whySwitchAllDisabled,
  whySwitchDisabled,
} from "./stand-in-choice-words.ts";

const RESETS_AT = "2026-11-18T14:00:00.000Z";

function aChoice(changes: Partial<StandInChoice> = {}): StandInChoice {
  return {
    runId: "0b5d3c1e-1f2a-4b3c-8d4e-5f6a7b8c9d0e",
    taskId: "1c6e4d2f-2a3b-4c4d-9e5f-6a7b8c9d0e1f",
    taskTitle: "Add a filter",
    projectId: "billing",
    stageKey: "implement",
    stageName: "Implement",
    engineName: "Claude Code",
    resetsAt: RESETS_AT,
    contextTokens: 182_000,
    askAbove: 100_000,
    standIn: { engineId: "claude-code-2", engineName: "Claude Code 2" },
    waitingSince: "2026-11-18T11:00:00.000Z",
    ...changes,
  };
}

describe("the Stand-in choice's words", () => {
  it("says why it asks, with the size Settings › Engines sets", () => {
    expect(standInContextLine([aChoice(), aChoice()])).toBe(
      "Their context is over the 100,000 tokens set in Settings › Engines, so the stand-in reads it all again without a prompt cache.",
    );
    expect(standInContextLine([aChoice()])).toMatch(/^Its context is over the 100,000 tokens/);
  });

  it("words a row's context, the engine that ran out with its reset, and the stand-in", () => {
    const now = new Date("2026-11-18T12:00:00.000Z");
    expect(contextSizeWords(aChoice())).toBe("182k context");
    expect(ranOutWords(aChoice(), now)).toBe(
      `Claude Code ran out; resets at ${momentWords(RESETS_AT, now)}`,
    );
    expect(standInWords(aChoice())).toBe("Moves to Claude Code 2");
    expect(standInWords(aChoice({ standIn: null }))).toBe("No Stand-in Engine has room now");
    expect(waitsForResetWords(aChoice(), now)).toBe(
      `Waits for the reset at ${momentWords(RESETS_AT, now)}`,
    );
  });

  it("says why Switch now can't be pressed", () => {
    expect(whySwitchDisabled(aChoice(), false)).toBeUndefined();
    expect(whySwitchDisabled(aChoice({ standIn: null }), false)).toBe(
      "No Stand-in Engine has room now.",
    );
    expect(whySwitchDisabled(aChoice(), true)).toBe("A switch is under way.");
    expect(whySwitchAllDisabled([aChoice({ standIn: null }), aChoice()], false)).toBeUndefined();
    expect(whySwitchAllDisabled([aChoice({ standIn: null })], false)).toBe(
      "No Stand-in Engine has room now.",
    );
  });

  it("narrows the rows to one Task, or to the Projects the filter shows", () => {
    const billing = aChoice();
    const search = aChoice({ runId: "x", taskId: "other", projectId: "search" });
    expect(shownChoices([billing, search], {})).toEqual([billing, search]);
    expect(shownChoices([billing, search], { taskId: "other" })).toEqual([search]);
    expect(
      shownChoices([billing, search], { projectShown: (projectId) => projectId === "billing" }),
    ).toEqual([billing]);
  });
});
