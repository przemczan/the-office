import { randomUUID } from "node:crypto";
import { stagesEditRefusalSchema, taskStagesSchema, type TaskStages } from "@the-office/contracts";
import { afterEach, describe, expect, it } from "vitest";
import type { Stage } from "../../domain/stage.js";
import {
  aDoneResult,
  anAgentSession,
  anAgentStage,
  runsOf,
  startPipelinesApplication,
  walkStages,
  type PipelinesApplication,
} from "../../pipelines-application.fixtures.js";

const tests: Stage = {
  kind: "script",
  key: "tests",
  name: "Tests",
  optional: false,
  command: "test",
  onFailure: { goBackTo: "implement", rounds: 2 },
};

let pipelines: PipelinesApplication | undefined;

afterEach(async () => {
  await pipelines?.app.close();
});

async function stagesOf(taskId: string): Promise<TaskStages> {
  if (!pipelines) throw new Error("The application isn't started.");
  const response = await fetch(`${await pipelines.app.getUrl()}/api/tasks/${taskId}/stages`);
  expect(response.status).toBe(200);
  return taskStagesSchema.parse(await response.json());
}

async function edit(taskId: string, stages: readonly Stage[]): Promise<Response> {
  if (!pipelines) throw new Error("The application isn't started.");
  return fetch(`${await pipelines.app.getUrl()}/api/tasks/${taskId}/stages`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stages }),
  });
}

describe("GET /api/tasks/:id/stages", () => {
  it("is null for a Task without Stages of its own: one not started yet", async () => {
    pipelines = await startPipelinesApplication();

    expect(await stagesOf(randomUUID())).toEqual({
      stages: null,
      editedForTask: false,
      testResults: [],
    });
  });

  it("gives each of the Task's own Stages with where it stands, its tokens and its runs", async () => {
    pipelines = await startPipelinesApplication([
      anAgentSession(aDoneResult("Added the field.", "The form is done; check the list.")),
    ]);
    const taskId = await walkStages(pipelines, [anAgentStage("implement"), tests]);
    const [run] = await runsOf(pipelines, taskId);

    const { stages, testResults } = await stagesOf(taskId);

    expect(stages?.map(({ stage, state, tokens }) => [stage.key, state, tokens])).toEqual([
      ["implement", "done", 20],
      ["tests", "done", 0],
    ]);
    expect(stages?.[0]?.runs).toEqual([
      {
        id: run?.id,
        number: 1,
        startedAt: run?.startedAt.toISOString(),
        endedAt: run?.endedAt?.toISOString(),
        threadId: run?.threadId,
        session: "fresh",
        tokens: { input: 10, output: 10, cacheRead: 0, cacheCreation: 0 },
        carriedFailure: null,
        sentBack: null,
        commandRuns: [],
        gateAction: null,
        outcome: {
          status: "done",
          summary: "Added the field.",
          skipped: false,
          handoverNote: "The form is done; check the list.",
        },
      },
    ]);
    expect(stages?.[1]?.runs[0]?.commandRuns).toMatchObject([
      { purpose: "command", outcome: "passed" },
    ]);
    expect(testResults).toEqual([
      { stageKey: tests.key, name: tests.name, state: "passed", detail: "`npm run test` passed." },
    ]);
  });
});

describe("PUT /api/tasks/:id/stages", () => {
  it("saves the Stages for the Task and answers them, edited for the Task", async () => {
    pipelines = await startPipelinesApplication();
    const taskId = randomUUID();
    pipelines.tasks.put(taskId, { state: "ready", pipelineId: "quick-fix" });
    const stages = [anAgentStage("implement", { model: "claude-haiku-5-5", effort: "low" }), tests];

    const response = await edit(taskId, stages);

    expect(response.status).toBe(200);
    const saved = taskStagesSchema.parse(await response.json());
    expect(saved.editedForTask).toBe(true);
    expect(saved.stages?.map(({ stage }) => stage)).toEqual(stages);
    expect(await stagesOf(taskId)).toEqual(saved);
  });

  it("refuses Stages that can't run with every problem, on its Stage", async () => {
    pipelines = await startPipelinesApplication();
    const taskId = randomUUID();
    pipelines.tasks.put(taskId, { state: "ready", pipelineId: "quick-fix" });

    const response = await edit(taskId, [
      { ...tests, onFailure: { goBackTo: "implement", rounds: 1 } },
      anAgentStage("implement", { session: "continue" }),
    ]);

    expect(response.status).toBe(422);
    expect(stagesEditRefusalSchema.parse(await response.json()).problems).toEqual([
      {
        stageIndex: 0,
        text: "Stage 1 · Tests: on failure it can only go back to an earlier Stage.",
      },
      {
        stageIndex: 1,
        text: "Stage 2 · implement: continuing a session needs the same Role in the Stage before.",
      },
    ]);
  });
});
