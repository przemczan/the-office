import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import { isRunning } from "../../../../platform/os/process-trees.fixtures.js";
import { EngineReadTimedOut } from "../../ports/agent-engine.js";
import {
  fakeClaudeCodeP,
  fakeClaudeCodePRuns,
} from "../claude-code-p/fake-claude-code-p.fixtures.js";
import { readUsageWindowsOnSdk, sdkUsageReadOptions } from "./usage-window-read.js";

function notStarted(): never {
  throw new Error("Not started here.");
}

describe("readUsageWindowsOnSdk", () => {
  let folder: string;
  let report: string;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "office-sdk-read-"));
    report = join(folder, "engine.jsonl");
  });

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it("runs on the engine's config folder with no tools, no settings and no session kept", () => {
    expect(sdkUsageReadOptions(folder, { PATH: "/bin" }, notStarted)).toMatchObject({
      cwd: folder,
      env: { PATH: "/bin", CLAUDE_CONFIG_DIR: folder },
      tools: [],
      settingSources: [],
      strictMcpConfig: true,
      persistSession: false,
    });
  });

  it("ends the query's engine when it doesn't answer in time, throwing EngineReadTimedOut", async () => {
    await expect(
      readUsageWindowsOnSdk(
        {
          configFolder: folder,
          environment: { PATH: process.env["PATH"] ?? "" },
          processTrees: currentOperatingSystem().processTrees,
          command: (asked) => ({ ...fakeClaudeCodeP(report, "silent", []), signal: asked.signal }),
        },
        { what: "Reading the usage windows", signal: new AbortController().signal, timeoutMs: 500 },
      ),
    ).rejects.toBeInstanceOf(EngineReadTimedOut);

    const [run] = await fakeClaudeCodePRuns(report);
    if (run === undefined) throw new Error("The engine never started.");
    expect(isRunning(run.processId)).toBe(false);
  });
});
