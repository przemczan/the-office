import type { Stage, StageRun, TaskStage } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { pipelineLabel, scriptCommandLine, taskTokens } from "./stage-words.ts";
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
