import { describe, expect, it } from "vitest";
import { scriptStageOutcome } from "./script-stage-outcome.js";
import type { CommandRun } from "./stage-command-run.js";

function aRun(fields: Partial<CommandRun>): CommandRun {
  return {
    commandLine: "npm test",
    outcome: "failed",
    exitCode: 1,
    durationMs: 1000,
    output: "",
    wholeOutput: "",
    ...fields,
  };
}

describe("scriptStageOutcome", () => {
  it("is done when the only run passed", () => {
    expect(scriptStageOutcome([aRun({ outcome: "passed", exitCode: 0 })])).toEqual({
      status: "done",
      summary: "`npm test` passed.",
    });
  });

  it.each([
    [
      aRun({ outcome: "could-not-run", exitCode: 127 }),
      "`npm test` couldn't be run: the shell couldn't start it, as when its program isn't installed.",
    ],
    [
      aRun({ outcome: "timed-out", exitCode: undefined, durationMs: 30 * 60_000 }),
      "`npm test` ran out of time after 30 minutes and was ended.",
    ],
    [aRun({ outcome: "stopped", exitCode: undefined }), "`npm test` was stopped by The Office."],
  ])("fails with how a run that wasn't re-run ended", (run, error) => {
    expect(scriptStageOutcome([run])).toEqual({ status: "failed", error });
  });

  it("leaves out what it printed when it printed nothing", () => {
    expect(scriptStageOutcome([aRun({ output: "  \n" })])).toEqual({
      status: "failed",
      error: "`npm test` failed with exit code 1.",
    });
  });

  it("refuses runs that never happened", () => {
    expect(() => scriptStageOutcome([])).toThrow("ran no times");
  });
});
