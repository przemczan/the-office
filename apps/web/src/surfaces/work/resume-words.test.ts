import type { Stage, StageRun, TaskStage, Thread, ThreadContext } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { latestRunOf, resumeWords, type HeldWork } from "./resume-words.ts";
import { NO_TOKENS } from "../../shell/token-words.ts";

const THREAD_ID = "5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

function aRun(fields: Partial<StageRun>): StageRun {
  return {
    id: "8f0b1a52-3c1e-4a4e-9d0e-1f5b6c7d8e9f",
    number: 1,
    startedAt: "2026-10-26T10:00:00.000Z",
    endedAt: "2026-10-26T10:18:00.000Z",
    threadId: THREAD_ID,
    session: "fresh",
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    carriedFailure: null,
    sentBack: null,
    gateAction: null,
    commandRuns: [],
    outcome: null,
    ...fields,
  };
}

function held(interrupted: "pause" | "stop" | "restart"): StageRun {
  return aRun({
    outcome: {
      status: "failed",
      error: "Held.",
      budgetReached: null,
      interrupted,
      handoverNote: null,
    },
  });
}

function aThread(context: Partial<ThreadContext>): Thread {
  return {
    id: THREAD_ID,
    home: { kind: "task", taskId: "0c9d8e7f-6a5b-4c3d-9e2f-1a0b9c8d7e6f" },
    roleKey: "developer",
    title: "Implement",
    state: "waiting",
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    context: {
      move: "resume",
      reason: "cache-warm",
      cacheWarm: true,
      cacheWarmUntil: null,
      contextTokens: 41_000,
      briefTokens: null,
      alternatives: [],
      override: null,
      ...context,
    },
    startedAt: "2026-10-26T10:00:00.000Z",
    stageThread: true,
    consultation: null,
    changesAllowed: null,
    answered: null,
    lastMovedAt: null,
  };
}

function heldWork(fields: Partial<HeldWork>): HeldWork {
  return {
    latestRun: held("pause"),
    thread: aThread({}),
    personName: "Ada",
    decisionOpen: false,
    ...fields,
  };
}

describe("resumeWords", () => {
  it("says a held Stage goes on in its Thread as the Context policy decides", () => {
    expect(resumeWords(heldWork({}))).toEqual({
      label: "Resume · continues Ada's session",
      hint: "The Stage runs again in its Thread: Continuing · cache warm · 41k context.",
    });
    expect(
      resumeWords(
        heldWork({
          latestRun: held("stop"),
          thread: aThread({
            move: "fresh",
            reason: "cache-expired",
            cacheWarm: false,
            cacheWarmUntil: null,
            contextTokens: 48_000,
            briefTokens: 3_000,
          }),
        }),
      ),
    ).toEqual({
      label: "Resume · fresh session with a Brief",
      hint: "The Stage runs again in its Thread: Fresh · cache expired, 48k context · brief ~3k.",
    });
  });

  it("says so while the Agent's turn still ends before the Pause holds it", () => {
    expect(resumeWords(heldWork({ latestRun: aRun({ endedAt: null }) })).label).toBe(
      "Resume · continues Ada's session",
    );
  });

  it("waits on an open Decision first", () => {
    expect(resumeWords(heldWork({ decisionOpen: true })).label).toBe("Resume · after your answer");
  });

  it("asks before running a Stage The Office restarted during", () => {
    expect(resumeWords(heldWork({ latestRun: held("restart") })).label).toBe(
      "Resume · asks before running it again",
    );
  });

  it("goes on with the Pipeline after a Script Stage or between Stages", () => {
    const script = aRun({ threadId: null, session: null });
    expect(resumeWords(heldWork({ latestRun: script, thread: undefined })).label).toBe("Resume");
    const done = aRun({
      outcome: {
        status: "done",
        summary: "Done.",
        skipped: false,
        definitionOfDoneMet: null,
        pullRequestUrl: null,
        handoverNote: "Left: nothing.",
      },
    });
    expect(resumeWords(heldWork({ latestRun: done })).label).toBe("Resume");
  });
});

describe("latestRunOf", () => {
  it("finds the Task's latest run across its Stages", () => {
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
    const stages: TaskStage[] = [
      {
        stage: implement,
        state: "paused",
        tokens: NO_TOKENS,
        wentBack: null,
        runs: [aRun({ number: 1 }), aRun({ number: 3 })],
      },
      {
        stage: tests,
        state: "done",
        tokens: NO_TOKENS,
        wentBack: null,
        runs: [aRun({ number: 2 })],
      },
    ];

    expect(latestRunOf(stages)).toMatchObject({
      run: { number: 3 },
      taskStage: { stage: implement },
    });
    expect(latestRunOf([])).toBeUndefined();
  });
});
