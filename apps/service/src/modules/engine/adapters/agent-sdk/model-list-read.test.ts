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
  type FakeClaudeCodePMode,
} from "../claude-code-p/fake-claude-code-p.fixtures.js";
import { listModelsOnSdk } from "./model-list-read.js";

describe("listModelsOnSdk", () => {
  let folder: string;
  let report: string;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "office-sdk-models-"));
    report = join(folder, "engine.jsonl");
  });

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  function listed(mode: FakeClaudeCodePMode, timeoutMs?: number) {
    return listModelsOnSdk(
      {
        configFolder: folder,
        environment: { PATH: process.env["PATH"] ?? "" },
        processTrees: currentOperatingSystem().processTrees,
        command: (asked) => ({ ...fakeClaudeCodeP(report, mode, []), signal: asked.signal }),
      },
      { what: "Listing the models", signal: new AbortController().signal, timeoutMs },
    );
  }

  async function theEngine() {
    const [run] = await fakeClaudeCodePRuns(report);
    if (run === undefined) throw new Error("The engine never started.");
    return run;
  }

  it("answers the full ids of the models the engine's initialize lists, sending no message, then ends it", async () => {
    await expect(listed("answers")).resolves.toEqual(["claude-opus-5-5", "claude-sonnet-5-5"]);

    const run = await theEngine();
    expect(run.received).not.toContainEqual(expect.objectContaining({ type: "user" }));
    expect(isRunning(run.processId)).toBe(false);
  });

  it("ends the query's engine when it doesn't answer in time, throwing EngineReadTimedOut", async () => {
    await expect(listed("silent", 500)).rejects.toBeInstanceOf(EngineReadTimedOut);

    expect(isRunning((await theEngine()).processId)).toBe(false);
  });
});
