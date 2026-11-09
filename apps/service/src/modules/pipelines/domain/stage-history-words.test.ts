import { describe, expect, it } from "vitest";
import { agentStage, scriptStage } from "./stage.fixtures.js";
import type { StageCommandRun } from "./stage-command-run.js";
import { aStageRun } from "./stage-run.fixtures.js";
import {
  STAGE_HISTORY_READ_LIMIT,
  stageHistoryWords,
  stageRunWords,
} from "./stage-history-words.js";

const implement = agentStage();
const tests = scriptStage({ onFailure: { goBackTo: "implement", rounds: 2 } });
const stages = [implement, tests];

function aCommand(fields: Partial<StageCommandRun> = {}): StageCommandRun {
  return {
    purpose: "command",
    commandLine: "npm test",
    outcome: "passed",
    exitCode: 0,
    durationMs: 1200,
    output: "All 12 tests passed.",
    ...fields,
  };
}

const failedTest = aCommand({
  outcome: "failed",
  exitCode: 1,
  durationMs: 125_000,
  output: "FAIL renames a device",
});

/** The notnullsoft case: the tests fail, the Pipeline goes back to Implement, then they pass. */
const wentBackThenPassed = [
  aStageRun({
    number: 1,
    startedAt: new Date("2026-11-08T10:00:00Z"),
    endedAt: new Date("2026-11-08T10:05:00Z"),
  }),
  aStageRun({
    number: 2,
    stageKey: "tests",
    commandRuns: [
      aCommand({ purpose: "install", commandLine: "npm ci", output: "added 12 packages" }),
      failedTest,
      { ...failedTest, purpose: "re-run" },
    ],
    outcome: { status: "failed", error: "`npm test` failed with exit code 1 on its re-run too." },
  }),
  aStageRun({
    number: 3,
    carriedFailure: { stageKey: "tests", error: "`npm test` failed.", round: 1, rounds: 2 },
    outcome: {
      status: "done",
      summary: "Fixed the rename.",
      handoverNote: "Renamed in the store.",
    },
  }),
  aStageRun({
    number: 4,
    stageKey: "tests",
    commandRuns: [aCommand()],
    outcome: { status: "done", summary: "`npm test` passed." },
  }),
];

describe("stageHistoryWords", () => {
  it("tells every run in the order they ran, each command with its filtered output, when a Script Stage failed, went back and then passed", () => {
    const words = stageHistoryWords(stages, wentBackThenPassed);

    expect(words).toContain("4 in the order they ran");
    const runHeadings = words.match(/^## Run \d+: .*$/gm);
    expect(runHeadings).toEqual([
      "## Run 1: Implement (Agent Stage)",
      "## Run 2: Tests (Script Stage)",
      "## Run 3: Implement (Agent Stage)",
      "## Run 4: Tests (Script Stage)",
    ]);
    expect(words).toContain(
      "Started 2026-11-08T10:00:00.000Z, ended 2026-11-08T10:05:00.000Z (5 min).",
    );
    expect(words).toContain(
      "Outcome: failed.\n`npm test` failed with exit code 1 on its re-run too.",
    );
    expect(words).toContain("1. Install: `npm ci`, passed, exit code 0, 1.2 s.");
    expect(words).toContain("2. Command: `npm test`, failed, exit code 1, 2 min 5 s.");
    expect(words).toContain("3. Re-run: `npm test`, failed, exit code 1, 2 min 5 s.");
    expect(words).toContain("```\nFAIL renames a device\n```");
    expect(words).toContain('Ran again as "Tests" failed (round 1 of 2).');
    expect(words).toContain("Handover note: Renamed in the store.");
    expect(words).toContain("```\nAll 12 tests passed.\n```");
    expect(words).toContain("Outcome: done. `npm test` passed.");
  });

  it("tells an Agent Stage's Decision and its answer, its engine, model and tokens", () => {
    const words = stageHistoryWords(stages, [
      aStageRun({
        engineId: "claude-code",
        engineName: "Claude Code",
        model: "claude-sonnet-5-5",
        tokens: { input: 1200, output: 300, cacheRead: 40_000, cacheCreation: 2000 },
        decisions: [
          {
            id: "decision-1",
            kind: "agent",
            question: "Keep the old route?",
            options: [],
            answer: { kind: "answered", answer: "No, remove it." },
          },
          { id: "decision-2", kind: "no-retries-left", options: [], answer: undefined },
        ],
        outcome: {
          status: "needs-decision",
          question: "Keep the old route?",
          context: "Two callers use it.",
          options: ["Keep it", "Remove it"],
          recommendation: { option: 2, reason: "nothing outside uses it." },
        },
      }),
    ]);

    expect(words).toContain('Outcome: needs a decision. The Agent asked: "Keep the old route?"');
    expect(words).toContain("Options: 1. Keep it; 2. Remove it. Recommended: 2");
    expect(words).toContain('- The Agent asked "Keep the old route?". Answered: No, remove it.');
    expect(words).toContain("- The Stage failed with no retries left. Not answered yet.");
    expect(words).toContain("Engine: Claude Code, model claude-sonnet-5-5.");
    expect(words).toContain(
      "Tokens: 1200 input, 300 output, 40000 cache read, 2000 cache creation.",
    );
    expect(words).toContain("Project commands: none.");
  });

  it("tells why a run failed, and a run still going on", () => {
    const words = stageHistoryWords(stages, [
      aStageRun({
        outcome: {
          status: "failed",
          error: "The Stage was paused.",
          interrupted: "pause",
          budgetReached: { used: 120_000, budget: 100_000 },
        },
      }),
      aStageRun({ number: 2, outcome: undefined, endedAt: undefined }),
    ]);

    expect(words).toContain(
      "Outcome: failed (paused by the user; the Task's 120000 tokens reached the Stage's budget of 100000).",
    );
    expect(words).toContain("still running.");
    expect(words).toContain("Outcome: none yet, as the run is still going on.");
  });

  it("names a test run's moved files by their worktree paths alone, never the folder they went to", () => {
    const folder = "/var/lib/the-office/test-output/task/1";
    const words = stageHistoryWords(stages, [
      aStageRun({
        stageKey: "tests",
        commandRuns: [aCommand({ movedFiles: { folder, paths: ["screenshots/dialog.png"] } })],
      }),
    ]);

    expect(words).toContain(
      "Files the test run wrote, moved out of the worktree: screenshots/dialog.png",
    );
    expect(words).not.toContain(folder);
    expect(words).not.toContain("/var/lib/the-office");
  });

  it("answers plainly for a Task with no runs", () => {
    expect(stageHistoryWords(stages, [])).toBe("The Task has no Stage runs yet.");
  });
});

describe("stageRunWords", () => {
  const [, failedRun] = wentBackThenPassed;

  it("tells the run with each command's whole output in place of its filtered one", () => {
    const words = stageRunWords(stages, failedRun!, [
      "added 12 packages\nwhole",
      "the whole first run",
      "the whole re-run",
    ]);

    expect(words).toMatch(/^## Run 2: Tests \(Script Stage\)/);
    expect(words).toContain("```\nthe whole first run\n```");
    expect(words).toContain("```\nthe whole re-run\n```");
    expect(words).not.toContain("FAIL renames a device\n```");
  });

  it("falls back to the filtered output for a run saved before whole outputs were kept", () => {
    const words = stageRunWords(stages, failedRun!, ["added 12 packages", "FAIL renames a device"]);

    expect(words).toContain("```\nFAIL renames a device\n```");
  });

  it("fences an output that holds a fence of its own in a longer one", () => {
    const words = stageRunWords(stages, failedRun!, ["```\ncode\n```", "", "x"]);

    expect(words).toContain("````\n```\ncode\n```\n````");
    expect(words).toContain("(It printed nothing.)");
  });

  it("caps the answer, each long output keeping its end, and says what was cut", () => {
    const long = `${"start of the run\n".repeat(5000)}the end of the first run`;
    const longer = `${"y".repeat(100_000)}the end of the re-run`;

    const words = stageRunWords(stages, failedRun!, ["added 12 packages", long, longer]);

    expect(words.length).toBeLessThanOrEqual(STAGE_HISTORY_READ_LIMIT);
    expect(words).toContain("```\nadded 12 packages\n```");
    expect(words).toContain("the end of the first run\n```");
    expect(words).toContain("the end of the re-run\n```");
    expect(words).toMatch(/… \d+ characters cut from the start\n/);
    expect(words).toContain(
      "This answer is capped at 60000 characters: the start of 2 outputs were cut, each keeping its end.",
    );
  });
});
