import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { READ_STAGE_HISTORY_TOOL } from "../../../conversations/index.js";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";
import type { Stage } from "../../domain/stage.js";
import {
  aDoneResult,
  anAgentSession,
  anAgentStage,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../../pipelines-application.fixtures.js";
import { aCommandRun } from "../../ports/pipelines-ports.fixtures.js";

let pipelines: PipelinesApplication;

beforeEach(async () => {
  pipelines = await startPipelinesApplication([
    anAgentSession(aDoneResult()),
    anAgentSession(aDoneResult()),
  ]);
});

afterEach(async () => {
  await pipelines.app.close();
});

const tests: Stage = {
  kind: "script",
  key: "test",
  name: "Set up check",
  optional: false,
  command: "test",
  onFailure: { goBackTo: "implement", rounds: 1 },
};

function readStageHistory(input: Record<string, unknown>) {
  const [tool] = pipelines.app.get(OfficeToolRegistry).named([READ_STAGE_HISTORY_TOOL]);
  if (!tool) throw new Error(`No Office tool ${READ_STAGE_HISTORY_TOOL}.`);
  return tool.run(input, anOfficeToolCall("devops-chat"));
}

/** The notnullsoft case: the Script Stage fails, the walk goes back to Implement, then it passes. */
async function aTaskWhoseCheckFailedThenPassed(): Promise<string> {
  const failing = {
    ...aCommandRun("docker compose up", "failed", "port 5432 already in use"),
    wholeOutput: "Creating network…\nport 5432 already in use",
  };
  const passing = {
    ...aCommandRun("docker compose up", "passed", "Started."),
    wholeOutput: "Creating network…\nStarted.",
  };
  pipelines.commands.commandRuns.push([failing, failing], [passing]);
  return walkStages(pipelines, [anAgentStage("implement"), tests]);
}

describe("read_stage_history", () => {
  it("answers every run in the order they ran, both runs of a Script Stage that failed, went back and then passed with their commands' outputs", async () => {
    const taskId = await aTaskWhoseCheckFailedThenPassed();

    const { text, isError } = await readStageHistory({ taskId });

    expect(isError).toBe(false);
    expect(text.match(/^## Run \d+: .*$/gm)).toEqual([
      "## Run 1: implement (Agent Stage)",
      "## Run 2: Set up check (Script Stage)",
      "## Run 3: implement (Agent Stage)",
      "## Run 4: Set up check (Script Stage)",
    ]);
    expect(text).toContain("Command: `docker compose up`, failed, exit code 1");
    expect(text).toContain("Re-run: `docker compose up`, failed, exit code 1");
    expect(text).toContain("```\nport 5432 already in use\n```");
    expect(text).toContain("Command: `docker compose up`, passed, exit code 0");
    expect(text).toContain("```\nStarted.\n```");
  });

  it("answers one run by its number with each command's whole output", async () => {
    const taskId = await aTaskWhoseCheckFailedThenPassed();

    const failed = await readStageHistory({ taskId, runNumber: 2 });
    const passed = await readStageHistory({ taskId, runNumber: 4 });

    expect(failed.text).toMatch(/^## Run 2: Set up check \(Script Stage\)/);
    expect(failed.text).toContain("```\nCreating network…\nport 5432 already in use\n```");
    expect(failed.text).not.toContain("## Run 4");
    expect(passed.text).toContain("```\nCreating network…\nStarted.\n```");
  });

  it("answers plainly for an unknown Task and an unknown run number", async () => {
    const taskId = await aTaskWhoseCheckFailedThenPassed();
    const unknown = randomUUID();

    expect(await readStageHistory({ taskId: unknown })).toEqual({
      text: `The Task ${unknown} has no Stage runs: it hasn't started, or The Office has no Task of that id. list_tasks lists the Tasks with their ids.`,
      isError: false,
    });
    expect(await readStageHistory({ taskId, runNumber: 9 })).toEqual({
      text: "The Task has no run 9: its runs are numbered 1 to 4.",
      isError: false,
    });
  });
});
