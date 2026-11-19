import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import { isRunning } from "../../../../platform/os/process-trees.fixtures.js";
import { EngineReadTimedOut } from "../../ports/agent-engine.js";
import {
  FAKE_FIVE_HOUR_RESET,
  FAKE_SEVEN_DAY_RESET,
  fakeClaudeCodeP,
  fakeClaudeCodePRuns,
} from "./fake-claude-code-p.fixtures.js";
import { claudeCodePReadArguments, readUsageWindowsOnStreamJson } from "./usage-window-read.js";

const { processTrees } = currentOperatingSystem();

describe("readUsageWindowsOnStreamJson on a stand-in binary", () => {
  let folder: string;
  let report: string;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "office-claude-code-p-read-"));
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

  it("answers the windows of get_usage, asked before any message and keeping no session, then ends the binary", async () => {
    const windows = await readUsageWindowsOnStreamJson(
      fakeClaudeCodeP(report, "answers", claudeCodePReadArguments()),
      processTrees,
      { what: "Reading the usage windows", signal: new AbortController().signal },
    );

    expect(windows).toEqual({
      fiveHour: { percentUsed: 12, resetsAt: new Date(FAKE_FIVE_HOUR_RESET) },
      sevenDay: { percentUsed: 30, resetsAt: new Date(FAKE_SEVEN_DAY_RESET) },
      source: "usage-endpoint",
    });
    const run = await theRun();
    expect(run.argv).toContain("--no-session-persistence");
    expect(run.received).toEqual([
      {
        type: "control_request",
        request_id: expect.any(String),
        request: { subtype: "get_usage", skip_behaviors: true },
      },
    ]);
    expect(isRunning(run.processId)).toBe(false);
  });

  it("ends a binary that doesn't answer in time, throwing EngineReadTimedOut", async () => {
    await expect(
      readUsageWindowsOnStreamJson(fakeClaudeCodeP(report, "silent", []), processTrees, {
        what: "Reading the usage windows",
        signal: new AbortController().signal,
        timeoutMs: 300,
      }),
    ).rejects.toBeInstanceOf(EngineReadTimedOut);

    expect(isRunning((await theRun()).processId)).toBe(false);
  });
});
