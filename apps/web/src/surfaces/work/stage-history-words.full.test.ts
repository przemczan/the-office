import type { Stage, StageRun, TaskStage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { momentWords } from "../../shell/time.ts";
import { NO_TOKENS } from "../../shell/token-words.ts";
import {
  carriedFailureWords,
  commandMarkWords,
  commandTimeWords,
  gateChoiceWords,
  openingRunTab,
  runBadge,
  runGist,
  runOfHandoverNote,
  runResultText,
  runThreadClosedWords,
  runTimeWords,
  stageHistoryLine,
} from "./stage-history-words.ts";
import { stageNamesOf } from "./stage-words.ts";

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
  optional: true,
  command: "test",
  onFailure: { goBackTo: "implement", rounds: 3 },
};
const look: Stage = { kind: "gate", key: "look", name: "UI acceptance", optional: false };
const names = stageNamesOf([implement, tests, look]);
const now = new Date("2026-10-26T10:30:00.000Z");
const roles = [{ key: "developer", card: { name: "Ada", title: "Developer" } }] as never;

function aRun(fields: Partial<StageRun> = {}): StageRun {
  return {
    id: "8f0b1a52-3c1e-4a4e-9d0e-1f5b6c7d8e9f",
    number: 1,
    startedAt: "2026-10-26T10:00:00.000Z",
    endedAt: "2026-10-26T10:18:00.000Z",
    waitingSince: null,
    threadId: null,
    session: null,
    tokens: NO_TOKENS,
    carriedFailure: null,
    sentBack: null,
    gateAction: null,
    commandRuns: [],
    outcome: null,
    ...fields,
  };
}

function aTaskStage(stage: Stage, fields: Partial<TaskStage> = {}): TaskStage {
  return { stage, state: "pending", tokens: NO_TOKENS, wentBack: null, runs: [], ...fields };
}

const done = (fields: { summary: string; handoverNote: string | null }) =>
  ({
    status: "done",
    skipped: false,
    definitionOfDoneMet: null,
    pullRequestUrl: null,
    ...fields,
  }) as const;

const failed = (fields: Partial<Extract<StageRun["outcome"], { status: "failed" }>>) =>
  ({
    status: "failed",
    error: "2 tests failed.",
    budgetReached: null,
    interrupted: null,
    refusedTurn: null,
    handoverNote: null,
    ...fields,
  }) as const;

describe("stageHistoryLine", () => {
  it("says who works an Agent Stage, its budget and what its runs came to", () => {
    const tokens = { ...NO_TOKENS, input: 41_000 };
    expect(stageHistoryLine(aTaskStage(implement, { tokens, runs: [aRun()] }), roles, names)).toBe(
      "Agent Stage · Ada · Developer · budget 250k tokens · 41k tokens over 1 run",
    );
  });

  it("says a Script Stage's command and rule", () => {
    expect(stageHistoryLine(aTaskStage(tests), roles, names)).toBe(
      "Project command · test · optional · on failure back to Implement, at most 3×",
    );
  });

  it("says a Gate waits for the user", () => {
    expect(stageHistoryLine(aTaskStage(look), roles, names)).toBe("Gate · waits for you");
  });
});

describe("runThreadClosedWords", () => {
  it("says an ended run's Thread is read-only, and only a held one that it may go on", () => {
    expect(runThreadClosedWords(aRun({ outcome: done({ summary: "", handoverNote: null }) }))).toBe(
      "This run has ended, so its Thread is read-only.",
    );
    expect(runThreadClosedWords(aRun({ outcome: null }))).toBe(
      "This run isn't going on now, so its Thread takes no message.",
    );
  });
});

const noted = (id: string, threadId: string, handoverNote: string): StageRun =>
  aRun({ id, threadId, outcome: done({ summary: "", handoverNote }) });

describe("runOfHandoverNote", () => {
  const stages = [
    aTaskStage(implement, { runs: [noted("first", "a", "Old"), noted("second", "a", "New")] }),
    aTaskStage(tests, { runs: [noted("third", "a", "Tests' note"), noted("fourth", "b", "Old")] }),
  ];

  it("finds the run in the Thread that handed the note on, in whichever Stage", () => {
    expect(runOfHandoverNote(stages, "a", "New")).toEqual({
      stageKey: implement.key,
      runId: "second",
    });
    expect(runOfHandoverNote(stages, "a", "Tests' note")).toEqual({
      stageKey: tests.key,
      runId: "third",
    });
  });

  it("leaves another Thread's run out, and a note no run kept", () => {
    expect(runOfHandoverNote(stages, "b", "Old")?.runId).toBe("fourth");
    expect(runOfHandoverNote(stages, "b", "New")).toBeUndefined();
  });
});

describe("runTimeWords", () => {
  it("gives a finished run's times and how long it took", () => {
    const words = runTimeWords(aRun(), now);
    expect(words).toMatch(/^\d\d:00 → \d\d:18 · 18m$/);
  });

  it("says a run still going goes on until now", () => {
    const words = runTimeWords(aRun({ endedAt: null }), now);
    expect(words).toMatch(/^\d\d:00 → now · 30m so far$/);
  });
});

describe("runBadge", () => {
  it("lets the Stage's state speak for a run still going", () => {
    expect(runBadge(aRun(), "running")).toEqual({ words: "Running", tone: "info" });
    expect(runBadge(aRun({ waitingSince: "2026-10-26T10:20:00.000Z" }), "running")).toEqual({
      words: "Waiting for a run environment",
      tone: "info",
    });
    expect(runBadge(aRun(), "waiting-on-you")).toEqual({
      words: "Waiting on you",
      tone: "warning",
    });
  });

  it("tells a finished run by its outcome, not by the Stage's state now", () => {
    const outcome = done({ summary: "Passed.", handoverNote: null });
    expect(runBadge(aRun({ outcome }), "running").words).toBe("Done");
    expect(runBadge(aRun({ outcome: { ...outcome, skipped: true } }), "skipped").words).toBe(
      "Skipped",
    );
  });

  it("doesn't call a run that opened a long-answered Decision waiting", () => {
    const outcome = { status: "needs-decision", question: "Which?", handoverNote: null } as const;
    expect(runBadge(aRun({ outcome }), "done").words).toBe("Opened a Decision");
  });

  it("tells a held run from a failed one", () => {
    expect(runBadge(aRun({ outcome: failed({ interrupted: "stop" }) }), "stopped").words).toBe(
      "Stopped",
    );
    expect(runBadge(aRun({ outcome: failed({ interrupted: "alarm" }) }), "paused").words).toBe(
      "Paused",
    );
    expect(runBadge(aRun({ outcome: failed({ interrupted: "restart" }) }), "failed")).toEqual({
      words: "Failed",
      tone: "danger",
    });
  });
});

describe("runResultText", () => {
  it("words a run the usage window held with its reset in local time, not the service's UTC", () => {
    const resetsAt = "2026-11-13T14:00:00.000Z";
    const outcome = failed({
      error: "Paused: Claude Code's 5-hour window is used up until 2026-11-13 14:00 UTC.",
      interrupted: "usage-window",
      refusedTurn: {
        engineName: "Claude Code",
        windowWords: "5-hour window",
        resetsAt,
        sessionLeft: true,
      },
    });

    const text = runResultText(aTaskStage(implement), aRun({ outcome }));

    expect(text).toContain(
      `Paused: Claude Code's 5-hour window is used up until ${momentWords(resetsAt, new Date())}. `,
    );
    expect(text).not.toMatch(/UTC/);
  });

  it("gives a failure's whole error, or the budget it reached", () => {
    const stage = aTaskStage(tests);
    expect(runResultText(stage, aRun({ outcome: failed({ error: "One\nTwo" }) }))).toBe("One\nTwo");
    const budgetReached = { used: 120_000, budget: 100_000 };
    expect(runResultText(stage, aRun({ outcome: failed({ budgetReached }) }))).toBe(
      "The Task reached its budget: 120k of 100k tokens.",
    );
  });

  it("gives a summary once, when the Handover note doesn't already say it", () => {
    const stage = aTaskStage(implement);
    const own = done({ summary: "Built it.", handoverNote: "How it went." });
    const same = done({ summary: "Built it.", handoverNote: "Built it." });
    expect(runResultText(stage, aRun({ outcome: own }))).toBe("Built it.");
    expect(runResultText(stage, aRun({ outcome: same }))).toBeUndefined();
  });

  it("leaves a Gate's run to the user's action, and says what a waiting one waits for", () => {
    const outcome = done({ summary: "Continued.", handoverNote: null });
    expect(runResultText(aTaskStage(look), aRun({ outcome }))).toBeUndefined();
    expect(runResultText(aTaskStage(look, { state: "waiting-on-you" }), aRun())).toMatch(/^Waits/);
    expect(runResultText(aTaskStage(implement, { state: "running" }), aRun())).toBe("Working now.");
  });
});

describe("runGist", () => {
  it("gives what the run came to in plain words, on one line", () => {
    const run = aRun({
      outcome: done({ summary: "Moved **the** `redirect`.\n- Tested it", handoverNote: null }),
    });
    expect(runGist(aTaskStage(implement), run, names)).toBe("Moved the redirect. Tested it");
  });

  it("gives the summary even when the Handover note says the same", () => {
    const run = aRun({ outcome: done({ summary: "Moved it.", handoverNote: "Moved it." }) });
    expect(runGist(aTaskStage(implement), run, names)).toBe("Moved it.");
  });

  it("tells a Gate's run by what the user did", () => {
    const run = aRun({
      gateAction: { kind: "continue" },
      outcome: done({ summary: "", handoverNote: null }),
    });
    expect(runGist(aTaskStage(look), run, names)).toBe("You continued");
  });
});

describe("openingRunTab", () => {
  it("opens an ended run on its Summary and a running one on its Thread", () => {
    expect(openingRunTab(aRun({ outcome: failed({}) }))).toBe("summary");
    expect(openingRunTab(aRun())).toBe("thread");
  });
});

describe("a run's other words", () => {
  it("names the Stage whose failure it was briefed with", () => {
    expect(carriedFailureWords({ stageKey: "tests", round: 1, rounds: 3 }, names)).toBe(
      "Briefed with what failed in Tests, round 1 of 3",
    );
  });

  it("says what the user did at the Gate", () => {
    const sendBack = { kind: "send-back", stageKey: "implement", feedback: "Bigger." } as const;
    expect(gateChoiceWords(sendBack, names)).toBe("You sent back to Implement");
    expect(gateChoiceWords({ kind: "continue" }, names)).toBe("You continued");
    expect(gateChoiceWords({ kind: "drop" }, names)).toBe("You dropped the Task");
  });

  it("says what a command came to, and why it ran when that isn't plain", () => {
    const run = {
      commandLine: "npm test",
      durationMs: 120_000,
      purpose: "command",
      outcome: "passed",
    } as const;
    expect(commandMarkWords({ ...run, outcome: "passed" })).toBe("passed");
    expect(commandMarkWords({ ...run, outcome: "could-not-run" })).toBe("could not run");
    expect(commandTimeWords({ ...run, purpose: "command" })).toBe("2m");
    expect(commandTimeWords({ ...run, purpose: "re-run" })).toBe("re-run · 2m");
  });
});
