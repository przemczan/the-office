import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { READ_STAGE_HISTORY_TOOL } from "../../../conversations/index.js";
import { OfficeToolRegistry } from "../../../engine/index.js";
import { anOfficeToolCall } from "../../../engine/index.fixtures.js";
import { goingBackOnFailure } from "../../domain/stage.fixtures.js";
import {
  aDoneResult,
  anAgentSession,
  anAgentStage,
  runsOf,
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

/** As a previous release kept it, its on-failure setting read as a failure route back. */
const tests = goingBackOnFailure(
  { kind: "script", key: "test", name: "Set up check", optional: false, command: "test" },
  "implement",
  1,
);

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

  it("answers an Agent Stage's run by its number with what the Agent said in its Stage Thread, and the whole history with how many messages it logged", async () => {
    const taskId = await aTaskWhoseCheckFailedThenPassed();
    const [firstImplement] = await runsOf(pipelines, taskId);
    const said = pipelines.threadMessages.logged.find(
      ({ threadId }) => threadId === firstImplement?.threadId,
    );

    const run = await readStageHistory({ taskId, runNumber: 1 });
    const history = await readStageHistory({ taskId });

    expect(said?.text).toContain("Done.");
    expect(run.text).toContain(
      `Stage Thread, its messages from the run's start to its end:\n\n- ${said?.at.toISOString()} · the Agent: ${said?.text}`,
    );
    expect(history.text).toContain(
      "Stage Thread: 1 message logged during the run; read it with runNumber 1 for them.",
    );
    expect(history.text).not.toContain(said?.text);
  });

  it("answers plainly for an unknown Task, in the whole history and one run alike", async () => {
    const unknown = randomUUID();
    const answer = {
      text: `The Office has no Task ${unknown}. list_tasks lists the Tasks with their ids.`,
      isError: false,
    };

    expect(await readStageHistory({ taskId: unknown })).toEqual(answer);
    expect(await readStageHistory({ taskId: unknown, runNumber: 1 })).toEqual(answer);
  });

  it("answers plainly for a Task not started yet, naming its state as the board does", async () => {
    const planning = randomUUID();
    pipelines.tasks.put(planning, { state: "planning", pipelineId: undefined });
    const answer = {
      text: `The Task ${planning} hasn't started: it is in Planning, so no Stage has run yet.`,
      isError: false,
    };

    expect(await readStageHistory({ taskId: planning })).toEqual(answer);
    expect(await readStageHistory({ taskId: planning, runNumber: 1 })).toEqual(answer);
  });

  it("answers plainly for an unknown run number", async () => {
    const taskId = await aTaskWhoseCheckFailedThenPassed();

    expect(await readStageHistory({ taskId, runNumber: 9 })).toEqual({
      text: "The Task has no run 9: its runs are numbered 1 to 4.",
      isError: false,
    });
  });
});
