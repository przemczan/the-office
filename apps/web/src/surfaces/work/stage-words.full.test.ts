import type { Stage, StageRun, TaskStage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { pipelineLabel, pullRequestUrlOf, scriptCommandLine, taskTokens } from "./stage-words.ts";
import { NO_TOKENS } from "../../shell/token-words.ts";

const tests: Stage = {
  kind: "script",
  key: "tests",
  name: "Tests",
  optional: false,
  command: "test",
  onFailure: { goBackTo: "implement", rounds: 3 },
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
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
    context: null,
    carriedFailure: null,
    sentBack: null,
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
  const publish: Stage = {
    kind: "script",
    key: "publish",
    name: "Publish",
    optional: false,
    command: "publish",
  };
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
