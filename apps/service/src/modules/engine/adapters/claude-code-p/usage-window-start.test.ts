import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentOperatingSystem } from "../../../../platform/os/current-operating-system.js";
import { isRunning } from "../../../../platform/os/process-trees.fixtures.js";
import { EngineReadTimedOut } from "../../ports/agent-engine.js";
import { WINDOW_START_MODEL, WINDOW_START_PROMPT } from "../claude-code/usage-window-start.js";
import { fakeClaudeCodeP, fakeClaudeCodePRuns } from "./fake-claude-code-p.fixtures.js";
import {
  claudeCodePWindowStartArguments,
  startUsageWindowOnStreamJson,
} from "./usage-window-start.js";

const { processTrees } = currentOperatingSystem();

describe("claudeCodePWindowStartArguments", () => {
  it("runs one turn on the cheapest model with no tools, no settings, no MCP server and no session kept", () => {
    expect(claudeCodePWindowStartArguments()).toEqual(
      expect.arrayContaining([
        "--print",
        "--tools=",
        "--setting-sources=",
        "--strict-mcp-config",
        "--no-session-persistence",
        `--model=${WINDOW_START_MODEL}`,
        "--max-turns=1",
      ]),
    );
    expect(WINDOW_START_MODEL).toBe("claude-haiku-5-5");
  });
});

describe("startUsageWindowOnStreamJson on a stand-in binary", () => {
  let folder: string;
  let report: string;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "office-claude-code-p-start-"));
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

  it("sends the prompt as one message, answers the turn's tokens, then ends the binary", async () => {
    const started = await startUsageWindowOnStreamJson(
      fakeClaudeCodeP(report, "answers", claudeCodePWindowStartArguments()),
      WINDOW_START_PROMPT,
      processTrees,
      { what: "Starting the 5-hour window", signal: new AbortController().signal },
    );

    expect(started).toEqual({
      tokens: { input: 9, output: 2, cacheRead: 0, cacheCreation: 4 },
      model: WINDOW_START_MODEL,
    });
    const run = await theRun();
    expect(run.received).toEqual([
      expect.objectContaining({
        type: "user",
        message: { role: "user", content: WINDOW_START_PROMPT },
      }),
    ]);
    expect(isRunning(run.processId)).toBe(false);
  });

  it("ends a binary that doesn't answer in time, throwing EngineReadTimedOut", async () => {
    await expect(
      startUsageWindowOnStreamJson(
        fakeClaudeCodeP(report, "silent", []),
        WINDOW_START_PROMPT,
        processTrees,
        {
          what: "Starting the 5-hour window",
          signal: new AbortController().signal,
          timeoutMs: 300,
        },
      ),
    ).rejects.toBeInstanceOf(EngineReadTimedOut);

    expect(isRunning((await theRun()).processId)).toBe(false);
  });
});
