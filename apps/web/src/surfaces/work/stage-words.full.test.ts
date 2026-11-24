import type { EngineStandIn, Stage, StageRun, TaskStage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  engineStandInsReasons,
  engineStandInsShown,
  engineStandInsWords,
  pipelineLabel,
  pullRequestUrlOf,
  scriptCommandLine,
  taskTokens,
} from "./stage-words.ts";
import { NO_TOKENS } from "../../shell/token-words.ts";

const tests: Stage = {
  kind: "script",
  key: "tests",
  name: "Tests",
  optional: false,
  command: "test",
  routes: [
    {
      to: "implement",
      condition: { combine: "all", tests: [{ kind: "stage", stage: null, is: "failed" }] },
      limit: 3,
    },
    { to: null, condition: null, limit: null },
  ],
};

function aRun(fields: Partial<StageRun>): StageRun {
  return {
    id: "8f0b1a52-3c1e-4a4e-9d0e-1f5b6c7d8e9f",
    number: 1,
    startedAt: "2026-10-26T10:00:00.000Z",
    endedAt: "2026-10-26T10:18:00.000Z",
    waitingSince: null,
    threadId: null,
    session: null,
    engine: null,
    engineSwitches: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    context: null,
    carriedFailure: null,
    route: null,
    choice: null,
    sentBack: null,
    restart: null,
    restarted: null,
    startedOver: null,
    earlierStart: false,
    gateAction: null,
    commandRuns: [],
    outcome: null,
    ...fields,
  };
}

function aTaskStage(stage: Stage, fields: Partial<TaskStage>): TaskStage {
  return { stage, state: "pending", tokens: NO_TOKENS, wentBack: null, runs: [], ...fields };
}

describe("scriptCommandLine", () => {
  it("takes the command a Script Stage ran, not its install", () => {
    const ran = aRun({
      commandRuns: [
        { purpose: "install", commandLine: "npm ci", outcome: "passed", durationMs: 9_000 },
        { purpose: "command", commandLine: "npm test", outcome: "passed", durationMs: 9_000 },
      ],
    });

    expect(scriptCommandLine(aTaskStage(tests, { runs: [ran] }))).toBe("npm test");
  });
});

describe("pullRequestUrlOf", () => {
  const publish: Stage = { kind: "publish", key: "publish", name: "Publish", optional: false };
  const opened = "https://github.com/acme/site/pull/7";

  it("takes the pull request of a Publish whose after publishing line failed once it shipped", () => {
    const shipped = aRun({
      number: 2,
      outcome: {
        status: "failed",
        error: "Published; after publishing failed: exit code 1",
        budgetReached: null,
        interrupted: null,
        refusedTurn: null,
        afterPublishingFailed: {
          kind: "pull-request-opened",
          branch: "office/site-7",
          commit: "4b1e2c3",
          pullRequestUrl: opened,
        },
        publishResult: "after-publishing-failed",
        handoverNote: null,
      },
    });
    const plainFailure = aRun({
      number: 3,
      outcome: {
        status: "failed",
        error: "The push was refused.",
        budgetReached: null,
        interrupted: null,
        refusedTurn: null,
        afterPublishingFailed: null,
        publishResult: "failed",
        handoverNote: null,
      },
    });

    expect(pullRequestUrlOf([aTaskStage(publish, { runs: [shipped, plainFailure] })])).toBe(opened);
    expect(pullRequestUrlOf([aTaskStage(publish, { runs: [plainFailure] })])).toBeUndefined();
  });
});

describe("taskTokens", () => {
  it("adds the Task's Threads' tokens, each kind apart", () => {
    const tokens = { input: 10, output: 200, cacheRead: 30_000, cacheCreation: 4_000 };

    expect(taskTokens([{ tokens }, { tokens }])).toEqual({
      input: 20,
      output: 400,
      cacheRead: 60_000,
      cacheCreation: 8_000,
    });
    expect(taskTokens(undefined)).toEqual(NO_TOKENS);
  });
});

describe("pipelineLabel", () => {
  it("names the Pipeline, and says when its Stages were edited for the Task", () => {
    expect(pipelineLabel("Quick fix", false)).toBe("Quick fix");
    expect(pipelineLabel("Quick fix", true)).toBe("Quick fix · edited for this Task");
  });
});

describe("a Task's Stand-in Engines", () => {
  const forWork: EngineStandIn = {
    engineId: "work",
    engineName: "Work",
    standInId: "personal",
    standInName: "Personal",
    reason: "Work's 5-hour window would be passed; Personal had room.",
    short: "Work's window is full",
  };
  const forCodex: EngineStandIn = {
    engineId: "codex",
    engineName: "Codex",
    standInId: "spare",
    standInName: "Spare",
    reason: "Codex's weekly window would be passed.",
    short: "Codex's window is full",
  };

  it("names each stand-in and the engine it stands in for", () => {
    expect(engineStandInsWords([forWork])).toBe("On a Stand-in Engine: Personal for Work");
    expect(engineStandInsWords([forWork, forCodex])).toBe(
      "On a Stand-in Engine: Personal for Work, Spare for Codex",
    );
  });

  it("gives every reason for the hover", () => {
    expect(engineStandInsReasons([forWork, forCodex])).toBe(
      "Work's 5-hour window would be passed; Personal had room. Codex's weekly window would be passed.",
    );
  });

  it("shows them only while the Task is started", () => {
    const standIns = [forWork];
    for (const state of ["in-progress", "waiting-on-you", "paused"] as const) {
      expect(engineStandInsShown({ state, engineStandIns: standIns })).toEqual(standIns);
    }
    for (const state of ["ready", "done", "dropped"] as const) {
      expect(engineStandInsShown({ state, engineStandIns: standIns })).toEqual([]);
    }
  });
});
