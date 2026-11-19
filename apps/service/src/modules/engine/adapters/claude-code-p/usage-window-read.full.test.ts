import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import { isRunning } from "../../../../platform/os/process-trees.fixtures.js";
import { fakeClaudeCodeP, fakeClaudeCodePRuns } from "./fake-claude-code-p.fixtures.js";
import { readUsageWindowsOnStreamJson } from "./usage-window-read.js";

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

  it("ends the binary as the signal aborts, throwing its reason", async () => {
    const stopping = new AbortController();
    const read = readUsageWindowsOnStreamJson(fakeClaudeCodeP(report, "silent", []), processTrees, {
      what: "Reading the usage windows",
      signal: stopping.signal,
    });
    await vi.waitFor(async () => {
      expect((await fakeClaudeCodePRuns(report))[0]?.received).toHaveLength(1);
    });
    stopping.abort(new Error("The service is stopping."));

    await expect(read).rejects.toThrow("The service is stopping.");
    expect(isRunning((await theRun()).processId)).toBe(false);
  });

  it("starts no binary once the signal has aborted", async () => {
    const stopping = new AbortController();
    stopping.abort(new Error("The service is stopping."));

    await expect(
      readUsageWindowsOnStreamJson(fakeClaudeCodeP(report, "answers", []), processTrees, {
        what: "Reading the usage windows",
        signal: stopping.signal,
      }),
    ).rejects.toThrow("The service is stopping.");
    expect(await fakeClaudeCodePRuns(report)).toEqual([]);
  });
});
