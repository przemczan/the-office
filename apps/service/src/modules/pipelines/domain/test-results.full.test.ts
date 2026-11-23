import { describe, expect, it } from "vitest";
import type { Stage } from "./stage.js";
import type { StageOutcome } from "./stage-run.js";
import { aStageRun } from "./stage-run.fixtures.js";
import { latestTestResults } from "./test-results.js";

const implement: Stage = {
  kind: "agent",
  key: "implement",
  name: "Implement",
  optional: false,
  role: "developer",
  brief: "Do it.",
  session: "fresh",
  budget: 250_000,
};
const tests: Stage = {
  kind: "script",
  key: "tests",
  name: "Tests",
  optional: false,
  command: "test",
};
const lint: Stage = { kind: "script", key: "lint", name: "Lint", optional: true, command: "lint" };
const publish: Stage = { kind: "publish", key: "publish", name: "Publish", optional: false };

function aRun(number: number, stageKey: string, outcome: StageOutcome | undefined) {
  return aStageRun({ number, stageKey, outcome });
}

describe("latestTestResults", () => {
  it("gives each checking Script Stage its latest result, leaving out Agent Stages and Publish", () => {
    const results = latestTestResults(
      [implement, tests, lint, publish],
      [
        aRun(1, "implement", undefined),
        aRun(2, "tests", { status: "failed", error: "`npm test` failed with exit code 1\nmore" }),
        aRun(3, "implement", { status: "done", summary: "Fixed." }),
        aRun(4, "tests", { status: "done", summary: "`npm test` passed." }),
        aRun(5, "lint", { status: "done", summary: "Skipped.", skipped: true }),
      ],
    );

    expect(results).toEqual([
      { stageKey: "tests", name: "Tests", state: "passed", detail: "`npm test` passed." },
      { stageKey: "lint", name: "Lint", state: "skipped", detail: undefined },
    ]);
  });

  it("keeps the last result a run ended by itself, past runs the user held or The Office restarted", () => {
    const results = latestTestResults(
      [tests, lint],
      [
        aRun(2, "tests", { status: "failed", error: "`npm test` failed with exit code 1" }),
        aRun(3, "tests", { status: "failed", error: "Stopped.", interrupted: "stop" }),
        aRun(4, "tests", undefined),
        aRun(5, "lint", { status: "failed", error: "Restarted.", interrupted: "restart" }),
      ],
    );

    expect(results).toEqual([
      {
        stageKey: "tests",
        name: "Tests",
        state: "failed",
        detail: "`npm test` failed with exit code 1",
      },
      { stageKey: "lint", name: "Lint", state: "not-run", detail: undefined },
    ]);
  });
});
