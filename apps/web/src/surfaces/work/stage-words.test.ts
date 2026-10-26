import type { Stage, StageRun, TaskStage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  durationWords,
  latestHandoverNote,
  scriptCommandLine,
  stageNamesOf,
  stageProgressLine,
  taskTokens,
} from "./stage-words.ts";

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
  onFailure: { goBackTo: "implement", rounds: 3 },
};
const names = stageNamesOf([implement, tests]);
const now = new Date("2026-10-26T10:30:00.000Z");

function aRun(fields: Partial<StageRun>): StageRun {
  return {
    id: "8f0b1a52-3c1e-4a4e-9d0e-1f5b6c7d8e9f",
    number: 1,
    startedAt: "2026-10-26T10:00:00.000Z",
    endedAt: "2026-10-26T10:18:00.000Z",
    threadId: null,
    session: null,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    carriedFailure: null,
    sentBack: null,
    gateAction: null,
    commandRuns: [],
    outcome: null,
    ...fields,
  };
}

function aTaskStage(stage: Stage, fields: Partial<TaskStage>): TaskStage {
  return { stage, state: "pending", tokens: 0, wentBack: null, runs: [], ...fields };
}

const handedOver = {
  status: "done",
  summary: "Added the field.",
  skipped: false,
  handoverNote: "Backoff capped at 30 s.",
} as const;

describe("stageProgressLine", () => {
  it("tells a Stage not yet run with what it will do on failure", () => {
    expect(stageProgressLine(aTaskStage(tests, {}), names, now)).toBe(
      "Pending · on failure back to Implement, at most 3×",
    );
  });

  it("tells a done Agent Stage's time, tokens and session", () => {
    const run = aRun({ session: "fresh", outcome: handedOver });

    expect(
      stageProgressLine(
        aTaskStage(implement, { state: "done", tokens: 41_234, runs: [run] }),
        names,
        now,
      ),
    ).toBe("Done · 18 min · 41k tokens · fresh session");
  });

  it("tells a running round after a failure, timed until now", () => {
    const carried = { stageKey: "tests", round: 2, rounds: 3 };
    const run = aRun({ session: "resume", endedAt: null, carriedFailure: carried });

    expect(
      stageProgressLine(aTaskStage(implement, { state: "running", runs: [run] }), names, now),
    ).toBe("Running · 30 min · continued session · round 2 of 3 after Tests failed");
  });

  it("tells a failed script's first line and where its loop went back", () => {
    const run = aRun({
      outcome: {
        status: "failed",
        error: "`npm test` failed with exit code 1.\n```\n2 failed\n```",
        budgetReached: null,
        interrupted: null,
        handoverNote: null,
      },
    });
    const wentBack = { stageKey: "implement", round: 1, rounds: 3 };

    expect(
      stageProgressLine(aTaskStage(tests, { state: "failed", runs: [run], wentBack }), names, now),
    ).toBe("Failed · 18 min · npm test failed with exit code 1. · back to Implement, round 1 of 3");
  });

  it("tells a budget reached, and a skipped optional Stage", () => {
    const reached = aRun({
      outcome: {
        status: "failed",
        error: "The Task reached the budget.",
        budgetReached: { used: 130_000, budget: 120_000 },
        interrupted: null,
        handoverNote: null,
      },
    });
    const skipped = aRun({
      outcome: { status: "done", summary: "Skipped: met.", skipped: true, handoverNote: null },
    });

    expect(
      stageProgressLine(
        aTaskStage(implement, { state: "waiting-on-you", runs: [reached] }),
        names,
        now,
      ),
    ).toBe("Waiting on you · 18 min · reached its budget: 130k of 120k tokens");
    expect(
      stageProgressLine(aTaskStage(implement, { state: "skipped", runs: [skipped] }), names, now),
    ).toBe("Skipped · the Definition of Done was already met");
  });
});

describe("the Stage's Handover note and command", () => {
  it("takes the latest note any run wrote, and the command a Script Stage ran", () => {
    const ran = aRun({
      commandRuns: [
        { purpose: "install", commandLine: "npm ci", outcome: "passed", durationMs: 9_000 },
        { purpose: "command", commandLine: "npm test", outcome: "passed", durationMs: 9_000 },
      ],
    });

    expect(
      latestHandoverNote(
        aTaskStage(implement, { runs: [aRun({ outcome: handedOver }), aRun({ endedAt: null })] }),
      ),
    ).toBe("Backoff capped at 30 s.");
    expect(scriptCommandLine(aTaskStage(tests, { runs: [ran] }))).toBe("npm test");
  });
});

describe("durationWords", () => {
  it("rounds to minutes, and hours past an hour", () => {
    expect([20_000, 120_000, 4_200_000, 7_200_000].map(durationWords)).toEqual([
      "<1 min",
      "2 min",
      "1h 10 min",
      "2h",
    ]);
  });
});

describe("taskTokens", () => {
  it("counts the Task's Threads as budgets do, without cache reads", () => {
    const tokens = { input: 10, output: 200, cacheRead: 30_000, cacheCreation: 4_000 };

    expect(taskTokens([{ tokens }, { tokens }])).toBe(8_420);
    expect(taskTokens(undefined)).toBe(0);
  });
});

describe("stageProgressLine at a Gate", () => {
  const look: Stage = { kind: "gate", key: "look", name: "Look", optional: false };
  const gateNames = stageNamesOf([implement, tests, look]);
  const reached = {
    status: "done",
    summary: "The Task reached the Gate and waited for the user.",
    skipped: false,
    handoverNote: null,
  } as const;

  it("says what the user did there", () => {
    const sentBack = aRun({
      outcome: reached,
      gateAction: { kind: "send-back", stageKey: "implement", feedback: "Name it Save." },
    });

    expect(
      stageProgressLine(aTaskStage(look, { state: "done", runs: [sentBack] }), gateNames, now),
    ).toBe("Done · 18 min · sent back to Implement");
    expect(
      stageProgressLine(
        aTaskStage(look, { state: "waiting-on-you", runs: [aRun({ outcome: reached })] }),
        gateNames,
        now,
      ),
    ).toBe("Waiting on you · 18 min");
  });

  it("tells a Stage runs again for the Gate's feedback, with no round", () => {
    const running = aRun({
      endedAt: null,
      sentBack: { gateKey: "look", feedback: "Name it Save." },
    });

    expect(
      stageProgressLine(
        aTaskStage(implement, { state: "running", runs: [running] }),
        gateNames,
        now,
      ),
    ).toBe("Running · 30 min · sent back from Look");
  });
});
