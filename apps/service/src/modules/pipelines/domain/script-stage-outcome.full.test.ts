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
      "`npm test` couldn't be run, as when its program isn't installed or its run environment can't start.",
    ],
    [
      aRun({ outcome: "timed-out", exitCode: undefined, durationMs: 30 * 60_000 }),
      "`npm test` ran out of time after 30 minutes and was ended.",
    ],
    [aRun({ outcome: "stopped", exitCode: undefined }), "`npm test` was stopped by The Office."],
  ])("fails with how a run that wasn't re-run ended", (run, error) => {
    expect(scriptStageOutcome([run])).toEqual({ status: "failed", error });
  });

  it("is done when the re-run command passed, naming both lines and the flake", () => {
    const runs = [
      aRun({ output: "FAIL renames a device" }),
      aRun({ commandLine: "npm test -- --last-failed", outcome: "passed", exitCode: 0 }),
    ];

    expect(scriptStageOutcome(runs)).toEqual({
      status: "done",
      summary:
        "`npm test` failed, then passed when The Office ran its re-run command `npm test -- --last-failed`: a flake.",
    });
  });

  it("fails when the re-run command failed too, with what the re-run printed", () => {
    const runs = [
      aRun({ output: "FAIL the first run" }),
      aRun({ commandLine: "npm test -- --last-failed", output: "FAIL renames a device\n" }),
    ];

    expect(scriptStageOutcome(runs)).toEqual({
      status: "failed",
      error:
        "`npm test` failed, and its re-run command `npm test -- --last-failed` failed with exit code 1 too.\n\nWhat it printed:\n\n```\nFAIL renames a device\n```",
    });
  });

  it("fails with how the re-run command ended when it ran out of time", () => {
    const runs = [
      aRun({}),
      aRun({
        commandLine: "npm test -- --last-failed",
        outcome: "timed-out",
        exitCode: undefined,
        durationMs: 30 * 60_000,
      }),
    ];

    expect(scriptStageOutcome(runs)).toEqual({
      status: "failed",
      error:
        "`npm test` failed, and its re-run command `npm test -- --last-failed` ran out of time after 30 minutes and was ended too.",
    });
  });

  it("leaves out what it printed when it printed nothing", () => {
    expect(scriptStageOutcome([aRun({ output: "  \n" })])).toEqual({
      status: "failed",
      error: "`npm test` failed with exit code 1.",
    });
  });

  it("fails with why alone when the Project has no such command yet", () => {
    const why = "The Project has no test command yet. Set it on the Project's page, or ask Devops.";

    expect(
      scriptStageOutcome([aRun({ commandLine: "", outcome: "could-not-run", output: why })]),
    ).toEqual({ status: "failed", error: why });
  });

  it("refuses runs that never happened", () => {
    expect(() => scriptStageOutcome([])).toThrow("ran no times");
  });
});
