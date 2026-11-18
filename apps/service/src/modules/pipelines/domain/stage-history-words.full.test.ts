import { describe, expect, it } from "vitest";
import { agentStage, scriptStage } from "./stage.fixtures.js";
import type { StageCommandRun } from "./stage-command-run.js";
import { aStageRun } from "./stage-run.fixtures.js";
import {
  STAGE_HISTORY_READ_LIMIT,
  stageHistoryWords,
  stageRunThreadRoom,
  stageRunWords,
} from "./stage-history-words.js";

/** No run's Stage Thread counted, as for runs with none. */
const NO_THREADS: ReadonlyMap<string, number> = new Map();

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
    const words = stageHistoryWords(stages, wentBackThenPassed, NO_THREADS);

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

  it("tells the condition commands kept on the run the routes leave, by the route they weighed", () => {
    const condition = { key: "lint", to: "tests", routeIndex: 0, testPath: [0] };
    const weighed = aStageRun({
      commandRuns: [
        aCommand({ purpose: "install", commandLine: "npm ci", condition }),
        aCommand({ purpose: "condition", commandLine: "npm run lint", condition }),
        aCommand({
          purpose: "condition",
          commandLine: "npm run build",
          condition: { ...condition, to: null },
        }),
      ],
    });

    const words = stageHistoryWords(stages, [weighed], NO_THREADS);

    expect(words).toContain(
      "1. Install for the condition of the route to Tests: `npm ci`, passed, exit code 0, 1.2 s.",
    );
    expect(words).toContain(
      "2. Condition for the route to Tests: `npm run lint`, passed, exit code 0, 1.2 s.",
    );
    expect(words).toContain("3. Condition for the route to End: `npm run build`");
  });

  it("tells an Agent Stage's Decision and its answer, its engine, model and tokens", () => {
    const words = stageHistoryWords(
      stages,
      [
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
      ],
      NO_THREADS,
    );

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

  it("tells the engine a Stand-in Engine stood in for, and why", () => {
    const words = stageHistoryWords(
      stages,
      [
        aStageRun({
          engineId: "personal",
          engineName: "Personal",
          model: "claude-opus-5-5",
          standInFor: {
            engineId: "work",
            engineName: "Work",
            reason: "The Work engine's 5-hour window would pass its 80% cap",
          },
        }),
      ],
      NO_THREADS,
    );

    expect(words).toContain(
      "Engine: Personal, model claude-opus-5-5, as a Stand-in Engine for Work: The Work engine's 5-hour window would pass its 80% cap.",
    );
  });

  it("tells why a run failed, and a run still going on", () => {
    const words = stageHistoryWords(
      stages,
      [
        aStageRun({
          outcome: {
            status: "failed",
            error: "The Stage was paused.",
            interrupted: "pause",
            budgetReached: { used: 120_000, budget: 100_000 },
          },
        }),
        aStageRun({ number: 2, outcome: undefined, endedAt: undefined }),
      ],
      NO_THREADS,
    );

    expect(words).toContain(
      "Outcome: failed (paused by the user; the Task's 120000 tokens reached the Stage's budget of 100000).",
    );
    expect(words).toContain("still running.");
    expect(words).toContain("Outcome: none yet, as the run is still going on.");
  });

  it("names the user who paused or stopped a run", () => {
    const user = { userId: "00000000-0000-4000-8000-0000000005e1", name: "Ann Lee" };
    const words = stageHistoryWords(
      stages,
      [
        aStageRun({
          outcome: { status: "failed", error: "Paused.", interrupted: "pause", heldByUser: user },
        }),
        aStageRun({
          number: 2,
          outcome: { status: "failed", error: "Stopped.", interrupted: "stop", heldByUser: user },
        }),
      ],
      NO_THREADS,
    );

    expect(words).toContain("Outcome: failed (paused by the user Ann Lee).");
    expect(words).toContain("Outcome: failed (stopped by the user Ann Lee).");
  });

  it("names a test run's moved files by their worktree paths alone, never the folder they went to", () => {
    const folder = "/var/lib/the-office/test-output/task/1";
    const words = stageHistoryWords(
      stages,
      [
        aStageRun({
          stageKey: "tests",
          commandRuns: [aCommand({ movedFiles: { folder, paths: ["screenshots/dialog.png"] } })],
        }),
      ],
      NO_THREADS,
    );

    expect(words).toContain(
      "Files the test run wrote, moved out of the worktree: screenshots/dialog.png",
    );
    expect(words).not.toContain(folder);
    expect(words).not.toContain("/var/lib/the-office");
  });

  it("names how many messages each Agent Stage's run logged in its Stage Thread, and that its number reads them, without the messages", () => {
    const words = stageHistoryWords(
      stages,
      [
        aStageRun({ threadId: "thread-1" }),
        aStageRun({ number: 2, stageKey: "tests", commandRuns: [aCommand()] }),
        aStageRun({ number: 3, threadId: "thread-2" }),
      ],
      new Map([
        ["run-1", 14],
        ["run-3", 1],
      ]),
    );

    expect(words).toContain(
      "Stage Thread: 14 messages logged during the run; read it with runNumber 1 for them.",
    );
    expect(words).toContain(
      "Stage Thread: 1 message logged during the run; read it with runNumber 3 for them.",
    );
    expect(words.match(/^Stage Thread:/gm)).toHaveLength(2);
  });

  it("answers plainly for a Task with no runs", () => {
    expect(stageHistoryWords(stages, [], NO_THREADS)).toBe("The Task has no Stage runs yet.");
  });

  it("leaves the earliest runs out when their words alone would crowd the outputs out, keeping the latest", () => {
    const longNote = "A long Handover note. ".repeat(250);
    const runs = Array.from({ length: 40 }, (_, index) =>
      aStageRun({
        number: index + 1,
        stageKey: "tests",
        commandRuns: [aCommand({ output: `the output of run ${index + 1}` })],
        outcome: { status: "done", summary: "Ran.", handoverNote: longNote },
      }),
    );

    const words = stageHistoryWords(stages, runs, NO_THREADS);
    const shown = words.match(/^## Run \d+/gm) ?? [];

    expect(words.length).toBeLessThanOrEqual(STAGE_HISTORY_READ_LIMIT);
    expect(shown.at(-1)).toBe("## Run 40");
    expect(words).toContain("```\nthe output of run 40\n```");
    expect(words).not.toContain("## Run 1\n");
    expect(words).toContain(
      `The Task's Stage runs, 40 in the order they ran: the ${40 - shown.length} earliest are left out to keep this answer within 60000 characters.`,
    );
  });
});

describe("stageRunWords", () => {
  const [, failedRun] = wentBackThenPassed;

  it("tells the run with each command's whole output in place of its filtered one", () => {
    const words = stageRunWords(
      stages,
      failedRun!,
      ["added 12 packages\nwhole", "the whole first run", "the whole re-run"],
      undefined,
    );

    expect(words).toMatch(/^## Run 2: Tests \(Script Stage\)/);
    expect(words).toContain("```\nthe whole first run\n```");
    expect(words).toContain("```\nthe whole re-run\n```");
    expect(words).not.toContain("FAIL renames a device\n```");
  });

  it("falls back to the filtered output for a run saved before whole outputs were kept", () => {
    const words = stageRunWords(
      stages,
      failedRun!,
      ["added 12 packages", "FAIL renames a device"],
      undefined,
    );

    expect(words).toContain("```\nFAIL renames a device\n```");
  });

  it("fences an output that holds a fence of its own in a longer one", () => {
    const words = stageRunWords(stages, failedRun!, ["```\ncode\n```", "", "x"], undefined);

    expect(words).toContain("````\n```\ncode\n```\n````");
    expect(words).toContain("(It printed nothing.)");
  });

  it("caps the answer, each long output keeping its end, and says what was cut", () => {
    const long = `${"start of the run\n".repeat(5000)}the end of the first run`;
    const longer = `${"y".repeat(100_000)}the end of the re-run`;

    const words = stageRunWords(stages, failedRun!, ["added 12 packages", long, longer], undefined);

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

/** The Stage Thread's words as Conversations gives them: `needed` long, unless cut to `room`. */
function threadWords(needed: number, room: number): string {
  if (needed <= room) return "m".repeat(needed);
  const note = "\n… 12 more messages are left out: read_threads reads on.";
  return `${"m".repeat(room - note.length)}${note}`;
}

describe("an Agent Stage's run with its Stage Thread", () => {
  const agentRun = aStageRun({
    threadId: "thread-1",
    startedAt: new Date("2026-11-08T10:00:00Z"),
    endedAt: new Date("2026-11-08T10:05:00Z"),
    commandRuns: [aCommand(), { ...failedTest, purpose: "command" }],
  });

  function answerWith(outputs: readonly string[], messagesNeed: number) {
    const room = stageRunThreadRoom(stages, agentRun, outputs);
    const thread = threadWords(messagesNeed, room);
    return { room, thread, words: stageRunWords(stages, agentRun, outputs, thread) };
  }

  it("ends the run with its Stage Thread's messages from its start to its end", () => {
    const thread =
      "Thread messages logged from 2026-11-08 10:00 UTC to 2026-11-08 10:05 UTC: 1 in 1 Thread.\n\n- 2026-11-08 10:01 UTC · Jim, the Developer: Tried the old route first.";

    const words = stageRunWords(stages, agentRun, ["All 12 tests passed.", "FAIL"], thread);

    expect(words).toMatch(/^## Run 1: Implement \(Agent Stage\)/);
    expect(words).toContain("```\nFAIL\n```");
    expect(
      words.endsWith(`Stage Thread, its messages from the run's start to its end:\n\n${thread}`),
    ).toBe(true);
  });

  it("says the messages run to now while the run still runs", () => {
    const running = { ...agentRun, endedAt: undefined, outcome: undefined };

    expect(stageRunWords(stages, running, [], "- a message")).toContain(
      "Stage Thread, its messages from the run's start to now:\n\n- a message",
    );
  });

  it("gives the messages what long outputs leave, the outputs keeping the rest and the answer its cap", () => {
    const { thread, words } = answerWith(["x".repeat(100_000), "y".repeat(100_000)], 2_000);

    expect(thread).toHaveLength(2_000);
    expect(words).toContain(thread);
    expect(words).toMatch(/… \d+ characters cut from the start\n/);
    expect(words.length).toBeLessThanOrEqual(STAGE_HISTORY_READ_LIMIT);
    expect(words.length).toBeGreaterThan(STAGE_HISTORY_READ_LIMIT - 1_000);
  });

  it("gives long messages what short outputs leave, the outputs kept whole", () => {
    const { room, thread, words } = answerWith(["All 12 tests passed.", "FAIL"], 100_000);

    expect(room).toBeGreaterThan(STAGE_HISTORY_READ_LIMIT - 2_000);
    expect(words).toContain(thread);
    expect(words).toContain("```\nAll 12 tests passed.\n```");
    expect(words).not.toContain("characters cut from the start");
    expect(words.length).toBeLessThanOrEqual(STAGE_HISTORY_READ_LIMIT);
  });

  it("shares the room half and half when both are long, each within the cap, the cut messages saying how to read on", () => {
    const { room, thread, words } = answerWith(["x".repeat(100_000), "y".repeat(100_000)], 100_000);

    expect(room).toBeGreaterThan(STAGE_HISTORY_READ_LIMIT / 2 - 1_000);
    expect(room).toBeLessThan(STAGE_HISTORY_READ_LIMIT / 2 + 1_000);
    expect(words).toContain(thread);
    expect(words).toContain("12 more messages are left out: read_threads reads on.");
    const outputs = (words.match(/x+|y+/g) ?? []).reduce((sum, run) => sum + run.length, 0);
    expect(outputs).toBeGreaterThan(STAGE_HISTORY_READ_LIMIT / 2 - 2_000);
    expect(words.length).toBeLessThanOrEqual(STAGE_HISTORY_READ_LIMIT);
  });
});
