import type { Stage, StageRun, TaskStage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { NO_TOKENS } from "../../shell/token-words.ts";
import {
  carriedFailureWords,
  commandMarkWords,
  commandTimeWords,
  gateChoiceWords,
  runBadge,
  runResultText,
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
    expect(runBadge(aRun(), "running")).toEqual({ words: "Running", tone: "accent" });
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
