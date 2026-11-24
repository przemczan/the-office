import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import { isRunning } from "../../../../platform/os/process-trees.fixtures.js";
import { EngineReadTimedOut } from "../../ports/agent-engine.js";
import { fakeClaudeCodeP, fakeClaudeCodePRuns } from "./fake-claude-code-p.fixtures.js";
import { listModelsOnStreamJson } from "./model-list-read.js";
import { claudeCodePReadArguments } from "./usage-window-read.js";

const { processTrees } = currentOperatingSystem();

describe("listModelsOnStreamJson on a stand-in binary", () => {
  let folder: string;
  let report: string;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "office-claude-code-p-models-"));
    report = join(folder, "binary.jsonl");
  });

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  async function theRun() {
    const [run, ...more] = await fakeClaudeCodePRuns(report);
    if (run === undefined) throw new Error("The binary never started.");
    expect(more).toEqual([]);
    return run;
  }

  it("answers the full ids of the models initialize lists, asked before any message, then ends the binary", async () => {
    const models = await listModelsOnStreamJson(
      fakeClaudeCodeP(report, "answers", claudeCodePReadArguments()),
      processTrees,
      { what: "Listing the models", signal: new AbortController().signal },
    );

    expect(models).toEqual(["claude-opus-5-5", "claude-sonnet-5-5"]);
    const run = await theRun();
    expect(run.argv).toContain("--no-session-persistence");
    expect(run.received).toEqual([
      {
        type: "control_request",
        request_id: expect.any(String),
        request: { subtype: "initialize" },
      },
    ]);
    expect(isRunning(run.processId)).toBe(false);
  });

  it("ends a binary that doesn't answer in time, throwing EngineReadTimedOut", async () => {
    await expect(
      listModelsOnStreamJson(fakeClaudeCodeP(report, "silent", []), processTrees, {
        what: "Listing the models",
        signal: new AbortController().signal,
        timeoutMs: 300,
      }),
    ).rejects.toBeInstanceOf(EngineReadTimedOut);

    expect(isRunning((await theRun()).processId)).toBe(false);
  });
});
